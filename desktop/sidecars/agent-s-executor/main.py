from __future__ import annotations

import asyncio
import logging
import os
import signal
import uuid
from contextlib import asynccontextmanager
from typing import Dict, Optional

import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.responses import JSONResponse

from artifact_store import ArtifactStore
from config import Settings, load_settings
from models import (
    CancelSessionResponse,
    CreateSessionRequest,
    CreateSessionResponse,
    HealthResponse,
    RunAcceptedResponse,
    RunSessionRequest,
    StatusResponse,
    StopResponse,
    SessionArtifactsResponse,
    SessionApprovalDecisionRequest,
    SessionApprovalDecisionResponse,
    SessionEvent,
    SessionEventsResponse,
    SessionSummary,
)
from runner import RunnerContext, create_session_runner
from session_store import SessionConflictError, SessionNotFoundError, SessionStore


logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("kaypal-agent-s-executor")

settings = load_settings()
session_store = SessionStore()
artifact_store = ArtifactStore(settings.artifact_root)
run_tasks: Dict[str, asyncio.Task[None]] = {}


def _artifact_payload(artifact: object) -> dict:
    if hasattr(artifact, "model_dump"):
        return artifact.model_dump()
    return dict(artifact)


def _require_token(x_kaypal_agent_s_token: Optional[str] = Header(default=None)) -> None:
    if x_kaypal_agent_s_token != settings.auth_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or missing x-kaypal-agent-s-token",
        )


def _persist_event(event: SessionEvent) -> None:
    artifact_store.append_event(event.session_id, event)
    _sync_artifact_count(event.session_id)


def _record_event(
    session_id: str,
    *,
    event_type: str,
    status_value: str,
    run_id: Optional[str] = None,
    message: Optional[str] = None,
    step_index: Optional[int] = None,
    artifact_id: Optional[str] = None,
    payload: Optional[Dict] = None,
) -> SessionEvent:
    event = session_store.append_event(
        session_id,
        event_type=event_type,
        status=status_value,
        run_id=run_id,
        message=message,
        step_index=step_index,
        artifact_id=artifact_id,
        payload=payload or {},
    )
    _persist_event(event)
    return event


def _sync_artifact_count(session_id: str) -> None:
    session_store.set_artifact_count(
        session_id,
        len(artifact_store.list_artifacts(session_id)),
    )


def _write_session_summary(session_id: str) -> None:
    artifact_store.write_session_summary(session_store.get_session(session_id))
    _sync_artifact_count(session_id)


async def _sleep_with_cancel(session_id: str, delay_ms: int) -> bool:
    remaining = max(0.0, delay_ms / 1000.0)
    while remaining > 0:
        if session_store.is_cancellation_requested(session_id):
            return False
        slice_seconds = min(0.05, remaining)
        await asyncio.sleep(slice_seconds)
        remaining -= slice_seconds
    return not session_store.is_cancellation_requested(session_id)


async def _finish_cancelled(session_id: str, run_id: str, message: str) -> None:
    session_store.clear_cancellation_requested(session_id)
    _record_event(
        session_id,
        event_type="run_cancelled",
        status_value="cancelled",
        run_id=run_id,
        message=message,
        payload={"result": "cancelled"},
    )
    artifact_store.write_text_artifact(
        session_id,
        run_id,
        name="cancel.log",
        content=message + "\n",
        kind="log",
        metadata={"reason": "cancelled"},
    )
    session_store.increment_artifact_count(session_id)
    _write_session_summary(session_id)


runner = create_session_runner(
    RunnerContext(
        settings=settings,
        session_store=session_store,
        artifact_store=artifact_store,
        record_event=_record_event,
        sync_artifact_count=_sync_artifact_count,
        write_session_summary=_write_session_summary,
        sleep_with_cancel=_sleep_with_cancel,
        finish_cancelled=_finish_cancelled,
        artifact_payload=_artifact_payload,
    )
)


async def _run_session(session_id: str, run_id: str, request: RunSessionRequest) -> None:
    try:
        await runner.run(session_id, run_id, request)
    finally:
        run_tasks.pop(session_id, None)


@asynccontextmanager
async def lifespan(_: FastAPI):
    artifact_store.root.mkdir(parents=True, exist_ok=True)
    yield
    for task in list(run_tasks.values()):
        task.cancel()
    if run_tasks:
        await asyncio.gather(*run_tasks.values(), return_exceptions=True)
        run_tasks.clear()


app = FastAPI(
    title="Kaypal Agent-S Executor",
    version="0.1.0",
    lifespan=lifespan,
    dependencies=[Depends(_require_token)],
)


@app.exception_handler(SessionNotFoundError)
async def handle_missing_session(_, exc: SessionNotFoundError):
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND,
        content={"detail": str(exc)},
    )


@app.exception_handler(SessionConflictError)
async def handle_session_conflict(_, exc: SessionConflictError):
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": str(exc)},
    )


@app.get("/healthz", response_model=HealthResponse)
async def healthz() -> HealthResponse:
    session_count, running_count = session_store.counts()
    return HealthResponse(
        status="ok",
        service="agent-s-executor",
        host=settings.host,
        port=settings.port,
        runner_mode=settings.runner_mode,
        real_provider=settings.real_provider if settings.runner_mode == "real" else None,
        session_count=session_count,
        running_session_count=running_count,
        artifact_root=str(artifact_store.root),
        auth_header="x-kaypal-agent-s-token",
    )


@app.get("/status", response_model=StatusResponse)
async def statusz() -> StatusResponse:
    session_count, running_count = session_store.counts()
    state = "running" if running_count > 0 else "idle"
    mcp_info: dict = {"connected": False, "tool_count": 0, "endpoint": ""}
    try:
        from kaypal_mcp_client import get_mcp_client, load_mcp_config
        mcp_info["endpoint"] = load_mcp_config().endpoint
        mcp_info["connected"] = get_mcp_client().health()
        mcp_info["tool_count"] = len(get_mcp_client().list_tools())
    except Exception as exc:  # noqa: BLE001 - status endpoint should not 500 on mcp issues
        mcp_info["error"] = str(exc)
    return StatusResponse(
        state=state,
        service="agent-s-executor",
        version=app.version,
        pid=os.getpid(),
        runner_mode=settings.runner_mode,
        real_provider=settings.real_provider if settings.runner_mode == "real" else None,
        session_count=session_count,
        running_session_count=running_count,
        artifact_root=str(artifact_store.root),
        mcp=mcp_info,
    )


@app.post("/sessions", response_model=CreateSessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(request: CreateSessionRequest) -> CreateSessionResponse:
    session = session_store.create_session(request)
    artifact_store.create_session_layout(session.session_id)
    _write_session_summary(session.session_id)
    return CreateSessionResponse(session=session_store.get_session(session.session_id))


@app.post("/sessions/{session_id}/run", response_model=RunAcceptedResponse)
async def run_session(session_id: str, request: RunSessionRequest) -> RunAcceptedResponse:
    run_id = f"run_{uuid.uuid4().hex[:12]}"
    session = session_store.begin_run(
        session_id,
        run_id,
        task_type=request.task_type,
        metadata=request.metadata,
    )
    task = asyncio.create_task(_run_session(session_id, run_id, request))
    run_tasks[session_id] = task
    return RunAcceptedResponse(
        session_id=session_id,
        run_id=run_id,
        status=session.status,
    )


@app.get("/sessions/{session_id}", response_model=SessionSummary)
async def get_session(session_id: str) -> SessionSummary:
    return session_store.get_session(session_id)


@app.get("/sessions/{session_id}/events", response_model=SessionEventsResponse)
async def get_session_events(
    session_id: str,
    after_seq: int = Query(default=0, ge=0),
) -> SessionEventsResponse:
    events = session_store.list_events(session_id, after_seq=after_seq)
    next_seq = events[-1].seq if events else after_seq
    return SessionEventsResponse(
        session_id=session_id,
        after_seq=after_seq,
        next_seq=next_seq,
        events=events,
    )


@app.post("/sessions/{session_id}/cancel", response_model=CancelSessionResponse)
async def cancel_session(session_id: str) -> CancelSessionResponse:
    session = session_store.request_cancel(session_id)
    if session.status == "idle":
        session_store.clear_cancellation_requested(session_id)
        _record_event(
            session_id,
            event_type="run_cancelled",
            status_value="cancelled",
            message="Session cancelled before a run started.",
            payload={"result": "cancelled"},
        )
        _write_session_summary(session_id)
        session = session_store.get_session(session_id)
    return CancelSessionResponse(
        session_id=session_id,
        status=session.status,
        cancellation_requested=session.cancellation_requested,
    )


@app.post(
    "/sessions/{session_id}/approval",
    response_model=SessionApprovalDecisionResponse,
)
async def resolve_session_approval(
    session_id: str,
    request: SessionApprovalDecisionRequest,
) -> SessionApprovalDecisionResponse:
    current_session = session_store.get_session(session_id)
    active_run_id = current_session.active_run_id
    if request.decision == "approved":
        _record_event(
            session_id,
            event_type="approval_granted",
            status_value="running",
            run_id=active_run_id,
            message=request.comment or "Approval granted. Resuming external GUI run.",
            payload={
                "decision": request.decision,
                "comment": request.comment or "",
                "resolution": "manual",
            },
        )
        await runner.resolve_approval(session_id, request.decision, request.comment)
        latest_session = session_store.get_session(session_id)
        return SessionApprovalDecisionResponse(
            session_id=session_id,
            status=latest_session.status,
            decision=request.decision,
        )

    session = session_store.resolve_waiting_approval(
        session_id,
        decision=request.decision,
        comment=request.comment,
    )
    message = request.comment or "Approval rejected. Session failed."
    _record_event(
        session_id,
        event_type="approval_rejected",
        status_value="failed",
        run_id=active_run_id,
        message=message,
        payload={
            "decision": request.decision,
            "comment": request.comment or "",
            "resolution": "manual",
        },
    )
    _record_event(
        session_id,
        event_type="run_failed",
        status_value="failed",
        run_id=active_run_id,
        message=message,
        payload={
            "result": "approval_rejected",
            "decision": request.decision,
            "comment": request.comment or "",
        },
    )
    _write_session_summary(session_id)

    return SessionApprovalDecisionResponse(
        session_id=session_id,
        status=session.status,
        decision=request.decision,
    )


@app.get("/sessions/{session_id}/artifacts", response_model=SessionArtifactsResponse)
async def get_session_artifacts(session_id: str) -> SessionArtifactsResponse:
    session_store.get_session(session_id)
    return SessionArtifactsResponse(
        session_id=session_id,
        artifacts=artifact_store.list_artifacts(session_id),
    )


@app.post("/stop", response_model=StopResponse)
async def stop_sidecar() -> StopResponse:
    loop = asyncio.get_running_loop()

    def _terminate() -> None:
        try:
            os.kill(os.getpid(), signal.SIGTERM)
        except OSError:
            logger.exception("failed to stop Agent-S executor process")

    loop.call_later(0.1, _terminate)
    return StopResponse(status="stopping")


if __name__ == "__main__":
    logger.info(
        "starting Agent-S executor on %s:%s with artifact root %s (runner_mode=%s)",
        settings.host,
        settings.port,
        settings.artifact_root,
        settings.runner_mode,
    )
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=False)
