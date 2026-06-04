from __future__ import annotations

import asyncio
import base64
import importlib
import io
import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional, Protocol, Tuple
from urllib import error as urllib_error
from urllib import request as urllib_request

from artifact_store import ArtifactStore
from config import Settings
from models import RunSessionRequest, SessionEvent
from session_store import SessionConflictError, SessionNotFoundError, SessionStore


logger = logging.getLogger("kaypal-agent-s-executor.runner")


EventRecorder = Callable[..., SessionEvent]
ArtifactPayloadBuilder = Callable[[object], dict]
ArtifactCountSync = Callable[[str], None]
SessionSummaryWriter = Callable[[str], None]
SleepWithCancel = Callable[[str, int], Awaitable[bool]]
CancelledFinisher = Callable[[str, str, str], Awaitable[None]]


@dataclass(frozen=True)
class RunnerContext:
    settings: Settings
    session_store: SessionStore
    artifact_store: ArtifactStore
    record_event: EventRecorder
    sync_artifact_count: ArtifactCountSync
    write_session_summary: SessionSummaryWriter
    sleep_with_cancel: SleepWithCancel
    finish_cancelled: CancelledFinisher
    artifact_payload: ArtifactPayloadBuilder


class SessionRunner(Protocol):
    async def run(self, session_id: str, run_id: str, request: RunSessionRequest) -> None:
        ...

    async def resolve_approval(
        self,
        session_id: str,
        decision: str,
        comment: Optional[str] = None,
    ) -> None:
        ...


class RealProvider(Protocol):
    def run(
        self,
        session_id: str,
        run_id: str,
        request: RunSessionRequest,
    ) -> Dict[str, Any]:
        ...

    def resolve_approval(
        self,
        pending: PendingApproval,
        comment: Optional[str],
    ) -> Dict[str, Any]:
        ...


@dataclass
class PendingApproval:
    session_id: str
    run_id: str
    task_type: str
    instruction: str
    risk_level: str
    metadata: Dict[str, Any]
    approval_token: Optional[str] = None
    checkpoint_id: Optional[str] = None
    resume_endpoint: str = "/approval"
    provider_state: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class AgentSExecutionPolicy:
    permission_mode: str
    execution_policy: str
    allow_desktop_action_execution: bool
    requires_approval_for_execution: bool
    allowed_targets: Tuple[str, ...] = ()
    allowed_text_inputs: Tuple[str, ...] = ()


@dataclass(frozen=True)
class LoadedAgentSSdk:
    flavor: str
    agent_class: Any
    grounding_class_or_engine: Any


class MockSessionRunner:
    def __init__(self, context: RunnerContext) -> None:
        self.context = context

    async def run(self, session_id: str, run_id: str, request: RunSessionRequest) -> None:
        step_count = request.step_count or self.context.settings.default_step_count
        delay_ms = request.mock_step_delay_ms or self.context.settings.mock_step_delay_ms

        try:
            request_artifact = self.context.artifact_store.write_request_artifact(
                session_id,
                run_id,
                request.model_dump(),
            )
            self.context.sync_artifact_count(session_id)
            self.context.record_event(
                session_id,
                event_type="session_started",
                status_value="running",
                run_id=run_id,
                message="Mock Agent-S run started.",
                payload={
                    "instruction": request.instruction,
                    "risk_level": request.risk_level,
                    "request_artifact": self.context.artifact_payload(request_artifact),
                    "runner_mode": self.context.settings.runner_mode,
                },
            )

            if request.requires_approval:
                approval_artifact = self.context.artifact_store.write_text_artifact(
                    session_id,
                    run_id,
                    name="approval-checkpoint.txt",
                    content="Mock approval checkpoint auto-approved by the local runner.\n",
                    metadata={"mode": "auto-approved"},
                )
                self.context.sync_artifact_count(session_id)
                self.context.record_event(
                    session_id,
                    event_type="approval_required",
                    status_value="running",
                    run_id=run_id,
                    message="Approval checkpoint simulated and auto-approved.",
                    artifact_id=approval_artifact.artifact_id,
                    payload={
                        "approval_mode": "auto-approved",
                        "runner_mode": self.context.settings.runner_mode,
                    },
                )

            for step_index in range(1, step_count + 1):
                if self.context.session_store.is_cancellation_requested(session_id):
                    await self.context.finish_cancelled(
                        session_id,
                        run_id,
                        "Run cancelled before the next step started.",
                    )
                    return

                self.context.record_event(
                    session_id,
                    event_type="step_started",
                    status_value="running",
                    run_id=run_id,
                    message=f"Mock step {step_index} started.",
                    step_index=step_index,
                    payload={
                        "instruction": request.instruction,
                        "runner_mode": self.context.settings.runner_mode,
                    },
                )

                if not await self.context.sleep_with_cancel(session_id, delay_ms):
                    await self.context.finish_cancelled(
                        session_id,
                        run_id,
                        f"Run cancelled during step {step_index}.",
                    )
                    return

                screenshot_artifact = self.context.artifact_store.write_screenshot_artifact(
                    session_id,
                    run_id,
                    step_index=step_index,
                    label="mock-screen",
                )
                self.context.sync_artifact_count(session_id)
                self.context.record_event(
                    session_id,
                    event_type="screenshot_captured",
                    status_value="running",
                    run_id=run_id,
                    message=f"Placeholder screenshot captured for step {step_index}.",
                    step_index=step_index,
                    artifact_id=screenshot_artifact.artifact_id,
                    payload=self.context.artifact_payload(screenshot_artifact),
                )

                step_note = self.context.artifact_store.write_text_artifact(
                    session_id,
                    run_id,
                    name=f"step-{step_index:03d}-note.txt",
                    content=(
                        f"Mock runner step {step_index}\n"
                        f"instruction: {request.instruction}\n"
                        f"risk_level: {request.risk_level}\n"
                    ),
                    metadata={"step_index": step_index},
                )
                self.context.sync_artifact_count(session_id)

                if request.simulate_failure_step == step_index:
                    failure_message = f"Mock failure injected at step {step_index}."
                    self.context.session_store.mark_last_error(session_id, failure_message)
                    error_artifact = self.context.artifact_store.write_text_artifact(
                        session_id,
                        run_id,
                        name="error.log",
                        content=failure_message + "\n",
                        kind="log",
                        metadata={"step_index": step_index},
                    )
                    self.context.sync_artifact_count(session_id)
                    self.context.record_event(
                        session_id,
                        event_type="run_failed",
                        status_value="failed",
                        run_id=run_id,
                        message=failure_message,
                        step_index=step_index,
                        artifact_id=error_artifact.artifact_id,
                        payload={"step_note": self.context.artifact_payload(step_note)},
                    )
                    self.context.write_session_summary(session_id)
                    return

                self.context.record_event(
                    session_id,
                    event_type="step_completed",
                    status_value="running",
                    run_id=run_id,
                    message=f"Mock step {step_index} completed.",
                    step_index=step_index,
                    artifact_id=step_note.artifact_id,
                    payload={"step_note": self.context.artifact_payload(step_note)},
                )

            self.context.record_event(
                session_id,
                event_type="run_completed",
                status_value="completed",
                run_id=run_id,
                message="Mock Agent-S run completed successfully.",
                payload={
                    "result": "completed",
                    "step_count": step_count,
                    "runner_mode": self.context.settings.runner_mode,
                },
            )
            self.context.write_session_summary(session_id)
        except SessionNotFoundError:
            logger.warning("session %s disappeared while the mock run was active", session_id)
        except Exception as exc:
            logger.exception("mock runner failed for session %s", session_id)
            error_message = f"unexpected mock runner error: {exc}"
            self.context.session_store.mark_last_error(session_id, error_message)
            error_artifact = self.context.artifact_store.write_text_artifact(
                session_id,
                run_id,
                name="error.log",
                content=error_message + "\n",
                kind="log",
                metadata={"scope": "runner-exception"},
            )
            self.context.sync_artifact_count(session_id)
            self.context.record_event(
                session_id,
                event_type="run_failed",
                status_value="failed",
                run_id=run_id,
                message=error_message,
                artifact_id=error_artifact.artifact_id,
                payload={"error": str(exc)},
            )
            self.context.write_session_summary(session_id)

    async def resolve_approval(
        self,
        session_id: str,
        decision: str,
        comment: Optional[str] = None,
    ) -> None:
        raise SessionConflictError(
            f"session {session_id} cannot resolve approval in mock mode"
        )


class RealSessionRunner:
    def __init__(self, context: RunnerContext) -> None:
        self.context = context
        self._pending_approvals: Dict[str, PendingApproval] = {}
        self._provider = _create_real_provider(context)

    async def run(self, session_id: str, run_id: str, request: RunSessionRequest) -> None:
        if not self._provider:
            self.context.record_event(
                session_id,
                event_type="run_failed",
                status_value="failed",
                run_id=run_id,
                message=(
                    "Real Agent-S runner is not configured. "
                    "Check KAYPAL_AGENT_S_REAL_PROVIDER and provider-specific settings."
                ),
                payload={
                    "runner_mode": self.context.settings.runner_mode,
                    "real_provider": self.context.settings.real_provider,
                    "instruction": request.instruction,
                },
            )
            self.context.session_store.mark_last_error(
                session_id,
                "missing or invalid real Agent-S provider configuration",
            )
            self.context.write_session_summary(session_id)
            return

        try:
            request_artifact = self.context.artifact_store.write_request_artifact(
                session_id,
                run_id,
                request.model_dump(),
            )
            self.context.sync_artifact_count(session_id)
            self.context.record_event(
                session_id,
                event_type="session_started",
                status_value="running",
                run_id=run_id,
                message="External GUI agent run started.",
                payload={
                    "instruction": request.instruction,
                    "runner_mode": self.context.settings.runner_mode,
                    "request_artifact": self.context.artifact_payload(request_artifact),
                },
            )

            response = await asyncio.to_thread(
                self._provider.run,
                session_id,
                run_id,
                request,
            )
            self._persist_external_response(session_id, run_id, request, response)
        except SessionNotFoundError:
            logger.warning("session %s disappeared while the external run was active", session_id)
        except Exception as exc:
            logger.exception("external runner failed for session %s", session_id)
            error_message = f"external agent runner error: {exc}"
            self.context.session_store.mark_last_error(session_id, error_message)
            error_artifact = self.context.artifact_store.write_text_artifact(
                session_id,
                run_id,
                name="external-agent-error.log",
                content=error_message + "\n",
                kind="log",
                metadata={"scope": "external-agent"},
            )
            self.context.sync_artifact_count(session_id)
            self.context.record_event(
                session_id,
                event_type="run_failed",
                status_value="failed",
                run_id=run_id,
                message=error_message,
                artifact_id=error_artifact.artifact_id,
                payload={
                    "error": str(exc),
                    "runner_mode": self.context.settings.runner_mode,
                    "real_provider": self.context.settings.real_provider,
                },
            )
            self.context.write_session_summary(session_id)

    async def resolve_approval(
        self,
        session_id: str,
        decision: str,
        comment: Optional[str] = None,
    ) -> None:
        pending = self._pending_approvals.get(session_id)
        if pending is None:
            raise SessionConflictError(f"session {session_id} has no pending approval checkpoint")

        if decision not in {"approved", "rejected"}:
            raise SessionConflictError(f"unsupported approval decision: {decision}")

        if decision == "rejected":
            self._pending_approvals.pop(session_id, None)
            return

        try:
            response = await asyncio.to_thread(
                self._provider.resolve_approval,
                pending,
                comment,
            )
            self._pending_approvals.pop(session_id, None)
            self._persist_external_response(
                pending.session_id,
                pending.run_id,
                None,
                response,
                response_artifact_name="external-agent-approval-response.json",
            )
        except Exception as exc:
            logger.exception("external approval resume failed for session %s", session_id)
            error_message = f"external approval resume error: {exc}"
            self.context.session_store.mark_last_error(session_id, error_message)
            error_artifact = self.context.artifact_store.write_text_artifact(
                session_id,
                pending.run_id,
                name="external-agent-approval-error.log",
                content=error_message + "\n",
                kind="log",
                metadata={"scope": "external-agent-approval"},
            )
            self.context.sync_artifact_count(session_id)
            self.context.record_event(
                session_id,
                event_type="run_failed",
                status_value="failed",
                run_id=pending.run_id,
                message=error_message,
                artifact_id=error_artifact.artifact_id,
                payload={
                    "error": str(exc),
                    "runner_mode": self.context.settings.runner_mode,
                    "real_provider": self.context.settings.real_provider,
                },
            )
            self.context.write_session_summary(session_id)

    def _persist_external_response(
        self,
        session_id: str,
        run_id: str,
        request: Optional[RunSessionRequest],
        response: Dict[str, Any],
        *,
        response_artifact_name: str = "external-agent-response.json",
    ) -> None:
        self.context.artifact_store.write_json_artifact(
            session_id,
            run_id,
            name=response_artifact_name,
            payload=response,
            kind="json",
        )
        self.context.sync_artifact_count(session_id)

        steps = response.get("steps")
        if isinstance(steps, list):
            self._persist_external_steps(session_id, run_id, steps)

        artifacts = response.get("artifacts")
        if isinstance(artifacts, list):
            self._persist_external_artifacts(session_id, run_id, artifacts)

        final_status = response.get("status")
        summary = response.get("summary")
        if not isinstance(summary, str) or not summary.strip():
            summary = "External GUI agent run completed."

        if response.get("requires_user_confirmation"):
            self._pending_approvals[session_id] = PendingApproval(
                session_id=session_id,
                run_id=run_id,
                task_type=(
                    request.task_type
                    if request and request.task_type
                    else "desktop.gui.visual.real"
                ),
                instruction=request.instruction if request else "",
                risk_level=request.risk_level if request else "medium",
                metadata=dict(request.metadata) if request else {},
                approval_token=(
                    str(response.get("approval_token"))
                    if response.get("approval_token") is not None
                    else None
                ),
                checkpoint_id=(
                    str(response.get("checkpoint_id"))
                    if response.get("checkpoint_id") is not None
                    else None
                ),
                resume_endpoint=(
                    str(response.get("approval_resume_endpoint") or "/approval")
                ),
                provider_state=(
                    dict(response.get("provider_state"))
                    if isinstance(response.get("provider_state"), dict)
                    else {}
                ),
            )
            self.context.record_event(
                session_id,
                event_type="approval_required",
                status_value="waiting_approval",
                run_id=run_id,
                message="External GUI agent requested user confirmation.",
                payload={
                    "runner_mode": self.context.settings.runner_mode,
                    "response_status": final_status or "waiting_approval",
                    "instruction": request.instruction if request else "",
                    "risk_level": request.risk_level if request else "medium",
                    "approval_token": response.get("approval_token"),
                    "checkpoint_id": response.get("checkpoint_id"),
                    "approval_hint": response.get("approval_hint"),
                    "approval_prompt": response.get("approval_prompt"),
                    "real_provider": self.context.settings.real_provider,
                },
            )
            self.context.write_session_summary(session_id)
            return

        if final_status == "failed":
            self.context.session_store.mark_last_error(session_id, summary)
            self.context.record_event(
                session_id,
                event_type="run_failed",
                status_value="failed",
                run_id=run_id,
                message=summary,
                payload={
                    "runner_mode": self.context.settings.runner_mode,
                    "response_status": final_status,
                    "real_provider": self.context.settings.real_provider,
                },
            )
        else:
            self.context.record_event(
                session_id,
                event_type="run_completed",
                status_value="completed",
                run_id=run_id,
                message=summary,
                payload={
                    "runner_mode": self.context.settings.runner_mode,
                    "response_status": final_status or "completed",
                    "real_provider": self.context.settings.real_provider,
                },
            )

        self.context.write_session_summary(session_id)

    def _persist_external_steps(
        self,
        session_id: str,
        run_id: str,
        steps: List[Any],
    ) -> None:
        for raw_index, raw_step in enumerate(steps, start=1):
            step = raw_step if isinstance(raw_step, dict) else {"value": raw_step}
            step_index = int(step.get("step_index") or raw_index)
            step_title = str(step.get("title") or f"External step {step_index}")
            step_status = str(step.get("status") or "completed")

            self.context.record_event(
                session_id,
                event_type="step_started",
                status_value="running",
                run_id=run_id,
                message=step_title,
                step_index=step_index,
                payload={
                    "runner_mode": self.context.settings.runner_mode,
                    "source": "external-agent",
                },
            )

            screenshot = step.get("screenshot_base64")
            if isinstance(screenshot, str) and screenshot.strip():
                screenshot_bytes = self._decode_base64_payload(screenshot)
                screenshot_artifact = self.context.artifact_store.write_binary_artifact(
                    session_id,
                    run_id,
                    name=f"step-{step_index:03d}-external-screen.png",
                    content=screenshot_bytes,
                    kind="screenshot",
                    metadata={"step_index": step_index, "source": "external-agent"},
                )
                self.context.sync_artifact_count(session_id)
                self.context.record_event(
                    session_id,
                    event_type="screenshot_captured",
                    status_value="running",
                    run_id=run_id,
                    message=f"External screenshot captured for step {step_index}.",
                    step_index=step_index,
                    artifact_id=screenshot_artifact.artifact_id,
                    payload=self.context.artifact_payload(screenshot_artifact),
                )

            raw_step_artifact = self.context.artifact_store.write_json_artifact(
                session_id,
                run_id,
                name=f"step-{step_index:03d}-external.json",
                payload=step,
                kind="json",
            )
            self.context.sync_artifact_count(session_id)

            terminal_status = "failed" if step_status == "failed" else "running"
            self.context.record_event(
                session_id,
                event_type="step_completed" if step_status != "failed" else "step_failed",
                status_value=terminal_status,
                run_id=run_id,
                message=str(step.get("summary") or step_title),
                step_index=step_index,
                artifact_id=raw_step_artifact.artifact_id,
                payload={
                    "runner_mode": self.context.settings.runner_mode,
                    "step_artifact": self.context.artifact_payload(raw_step_artifact),
                    "source": "external-agent",
                },
            )

    def _persist_external_artifacts(
        self,
        session_id: str,
        run_id: str,
        artifacts: List[Any],
    ) -> None:
        for raw_index, raw_artifact in enumerate(artifacts, start=1):
            artifact = raw_artifact if isinstance(raw_artifact, dict) else {"value": raw_artifact}
            name = str(artifact.get("name") or f"external-artifact-{raw_index:03d}")
            kind = str(artifact.get("kind") or "json")
            metadata = artifact.get("metadata") if isinstance(artifact.get("metadata"), dict) else {}

            stored_artifact = None
            if kind == "screenshot":
                payload = artifact.get("base64") or artifact.get("content_base64")
                if isinstance(payload, str) and payload.strip():
                    stored_artifact = self.context.artifact_store.write_binary_artifact(
                        session_id,
                        run_id,
                        name=name,
                        content=self._decode_base64_payload(payload),
                        kind="screenshot",
                        metadata=metadata,
                    )
            elif kind in {"text", "log"}:
                text = artifact.get("text")
                if text is not None:
                    stored_artifact = self.context.artifact_store.write_text_artifact(
                        session_id,
                        run_id,
                        name=name,
                        content=str(text),
                        kind=kind,
                        metadata=metadata,
                    )
            else:
                payload = artifact.get("json")
                if isinstance(payload, dict):
                    stored_artifact = self.context.artifact_store.write_json_artifact(
                        session_id,
                        run_id,
                        name=name,
                        payload=payload,
                        kind="json",
                    )

            if stored_artifact is None:
                fallback_payload = artifact if isinstance(artifact, dict) else {"value": artifact}
                stored_artifact = self.context.artifact_store.write_json_artifact(
                    session_id,
                    run_id,
                    name=f"{name}.json" if not name.endswith(".json") else name,
                    payload=fallback_payload,
                    kind="json",
                )

            self.context.sync_artifact_count(session_id)
            self.context.record_event(
                session_id,
                event_type="artifact_captured",
                status_value="running",
                run_id=run_id,
                message=f"External artifact captured: {stored_artifact.filename}",
                artifact_id=stored_artifact.artifact_id,
                payload={
                    "runner_mode": self.context.settings.runner_mode,
                    "artifact": self.context.artifact_payload(stored_artifact),
                    "source": "external-agent",
                },
            )

    def _decode_base64_payload(self, payload: str) -> bytes:
        normalized = payload.strip()
        if "," in normalized and normalized.lower().startswith("data:"):
            normalized = normalized.split(",", 1)[1]
        return base64.b64decode(normalized)


def create_session_runner(context: RunnerContext) -> SessionRunner:
    if context.settings.runner_mode == "real":
        return RealSessionRunner(context)
    return MockSessionRunner(context)


def _build_mcp_tool_brief_global() -> str:
    """
    2026-06-04: 把 playwright-mcp 暴露的 browser_* 工具列成简短说明,
    让 LLM 知道可以调 (生成的 mcp_call action 会被 _execute_mcp_action 处理).
    """
    try:
        from kaypal_mcp_client import get_mcp_client
        tools = get_mcp_client().list_tools()
    except Exception:
        return ""
    if not tools:
        return ""
    lines = [
        "## 浏览器自动化工具 (通过 MCP playwright-mcp)",
        "当你需要操作浏览器时, 可以在 action 里使用 `mcp_call` 类型, 格式:",
        "  {\"action_type\": \"mcp_call\", \"tool_name\": \"browser_navigate\", \"tool_args\": {\"url\": \"...\"}}",
        "可用工具 (前 10 个):",
    ]
    for t in tools[:10]:
        desc = (t.get("description") or "").replace("\n", " ")[:80]
        lines.append(f"  - `{t.get('name')}`: {desc}")
    if len(tools) > 10:
        lines.append(f"  ... 还有 {len(tools) - 10} 个工具")
    lines.append("\n典型流程: navigate -> snapshot (拿 a11y tree) -> click/type/fill -> screenshot")
    return "\n".join(lines)


class ExternalHttpProvider:
    def __init__(self, context: RunnerContext) -> None:
        self.context = context

    def run(
        self,
        session_id: str,
        run_id: str,
        request: RunSessionRequest,
    ) -> Dict[str, Any]:
        base_url = self.context.settings.external_agent_base_url.rstrip("/")
        payload = {
            "session": {
                "session_id": session_id,
                "run_id": run_id,
                "task_type": request.task_type or "desktop.gui.visual.real",
            },
            "instruction": request.instruction,
            "risk_level": request.risk_level,
            "requires_approval": request.requires_approval,
            "metadata": request.metadata,
        }
        return _post_json(
            url=f"{base_url}/run",
            payload=payload,
            api_key=self.context.settings.external_agent_api_key,
            timeout_ms=self.context.settings.external_agent_timeout_ms,
            error_prefix="external agent",
        )

    def resolve_approval(
        self,
        pending: PendingApproval,
        comment: Optional[str],
    ) -> Dict[str, Any]:
        base_url = self.context.settings.external_agent_base_url.rstrip("/")
        payload = {
            "session": {
                "session_id": pending.session_id,
                "run_id": pending.run_id,
                "task_type": pending.task_type,
            },
            "decision": "approved",
            "comment": comment or "",
            "instruction": pending.instruction,
            "risk_level": pending.risk_level,
            "metadata": pending.metadata,
            "approval_token": pending.approval_token,
            "checkpoint_id": pending.checkpoint_id,
        }
        return _post_json(
            url=f"{base_url}{pending.resume_endpoint}",
            payload=payload,
            api_key=self.context.settings.external_agent_api_key,
            timeout_ms=self.context.settings.external_agent_timeout_ms,
            error_prefix="external approval",
        )


class AgentSSdkProvider:
    def __init__(self, context: RunnerContext) -> None:
        self.context = context
        self._sdk_loader: Optional[LoadedAgentSSdk] = None

    def run(
        self,
        session_id: str,
        run_id: str,
        request: RunSessionRequest,
    ) -> Dict[str, Any]:
        sdk = self._get_sdk_loader()

        api_key = self.context.settings.agent_s_sdk_api_key or self.context.settings.external_agent_api_key
        if not api_key:
            raise RuntimeError("Agent-S SDK provider requires KAYPAL_AGENT_S_SDK_API_KEY")

        model = self.context.settings.agent_s_sdk_model
        provider = self.context.settings.agent_s_sdk_model_provider
        agent = self._create_agent(sdk, api_key, model, provider)

        steps: List[Dict[str, Any]] = []
        artifacts: List[Dict[str, Any]] = []
        policy = _resolve_execution_policy(request)

        max_steps = self.context.settings.agent_s_sdk_max_steps
        # 2026-06-04: 注入 MCP 工具说明到 LLM prompt
        # Agent-S LLM 生成 mcp_call action 时, runner 走 KaypalMcpClient.call_tool
        mcp_tool_brief = _build_mcp_tool_brief_global()
        enriched_instruction = (
            f"{request.instruction}\n\n{mcp_tool_brief}" if mcp_tool_brief else request.instruction
        )
        for step_index in range(1, max_steps + 1):
            requires_approval = bool(request.requires_approval) or policy.requires_approval_for_execution
            step_result = self._predict_step_with_agent(
                agent,
                sdk,
                enriched_instruction,
                step_index,
                policy,
                execute_actions_now=policy.allow_desktop_action_execution and not requires_approval,
            )
            prediction_summary = step_result["prediction_summary"]
            steps.append(step_result["step"])
            artifacts.extend(step_result["artifacts"])

            if requires_approval and step_index == 1:
                return {
                    "status": "waiting_approval",
                    "summary": "Agent-S SDK planned the next desktop action and is waiting for approval.",
                    "steps": steps,
                    "artifacts": artifacts,
                    "requires_user_confirmation": True,
                    "approval_hint": "远程回复“允许”或“拒绝”，或在本地桌面端审批。",
                    "approval_prompt": prediction_summary["summary"],
                    "approval_token": f"agent-s-sdk-{session_id}-{run_id}",
                    "checkpoint_id": f"sdk-step-{step_index}",
                    "approval_resume_endpoint": "/approval",
                    "provider_state": {
                        "resume_step_index": step_index + 1,
                        "checkpoint_title": prediction_summary["title"],
                        "checkpoint_summary": prediction_summary["summary"],
                        "sdk_flavor": sdk.flavor,
                        "execution_policy": policy.execution_policy,
                        "permission_mode": policy.permission_mode,
                        "allow_desktop_action_execution": policy.allow_desktop_action_execution,
                        "allowed_targets": list(policy.allowed_targets),
                        "allowed_text_inputs": list(policy.allowed_text_inputs),
                        "action_candidate": step_result["action_candidate"] or {},
                    },
                }

        return {
            "status": "completed",
            "summary": (
                "Agent-S SDK provider produced a desktop action plan."
                if sdk.flavor == "legacy-s1"
                else "Agent-S SDK provider produced a desktop GUI action candidate."
            ),
            "steps": steps,
            "artifacts": artifacts,
        }

    def resolve_approval(
        self,
        pending: PendingApproval,
        comment: Optional[str],
    ) -> Dict[str, Any]:
        sdk = self._get_sdk_loader()

        api_key = self.context.settings.agent_s_sdk_api_key or self.context.settings.external_agent_api_key
        if not api_key:
            raise RuntimeError("Agent-S SDK provider requires KAYPAL_AGENT_S_SDK_API_KEY")

        model = self.context.settings.agent_s_sdk_model
        provider = self.context.settings.agent_s_sdk_model_provider
        agent = self._create_agent(sdk, api_key, model, provider)

        provider_state = pending.provider_state if isinstance(pending.provider_state, dict) else {}
        resume_step_index = max(1, int(provider_state.get("resume_step_index") or 2))
        resume_instruction = self._build_resume_instruction(
            pending,
            comment,
            provider_state,
        )
        policy = _resolve_execution_policy_from_provider_state(provider_state)
        step_result = self._predict_step_with_agent(
            agent,
            sdk,
            resume_instruction,
            resume_step_index,
            policy,
            execute_actions_now=policy.allow_desktop_action_execution,
        )

        return {
            "status": "completed",
            "summary": (
                "Agent-S SDK resumed after approval and produced a follow-up desktop action candidate."
            ),
            "steps": [step_result["step"]],
            "artifacts": [
                *step_result["artifacts"],
                {
                    "kind": "text",
                    "name": "agent-s-sdk-post-approval.txt",
                    "text": (
                        "Agent-S SDK provider resumed after approval.\n"
                        f"checkpoint_id: {pending.checkpoint_id or ''}\n"
                        f"previous_summary: {provider_state.get('checkpoint_summary', '')}\n"
                        f"comment: {comment or ''}\n"
                    ),
                    "metadata": {
                        "source": "agent-s-sdk",
                        "phase": "post-approval",
                        "resume_step_index": resume_step_index,
                        "permission_mode": policy.permission_mode,
                        "execution_policy": policy.execution_policy,
                    },
                }
            ],
            "provider_state": {
                "resumed_from_checkpoint": pending.checkpoint_id or "",
                "resume_step_index": resume_step_index,
                "approval_comment": comment or "",
                "permission_mode": policy.permission_mode,
                "execution_policy": policy.execution_policy,
                "allowed_targets": list(policy.allowed_targets),
                "allowed_text_inputs": list(policy.allowed_text_inputs),
            },
        }

    def _predict_step_with_agent(
        self,
        agent: Any,
        sdk: LoadedAgentSSdk,
        instruction: str,
        step_index: int,
        policy: AgentSExecutionPolicy,
        *,
        execute_actions_now: bool,
    ) -> Dict[str, Any]:
        try:
            screenshot_bytes = self._take_screenshot_bytes()
            prediction = self._predict(agent, sdk, instruction, screenshot_bytes)
        except Exception as exc:
            raise RuntimeError(f"Agent-S SDK predict failed at step {step_index}: {exc}") from exc

        prediction_summary = _normalize_agent_s_prediction(prediction)
        screenshot_base64 = base64.b64encode(screenshot_bytes).decode("ascii")
        action_candidate = _extract_agent_s_action_candidate(prediction_summary["raw"])
        execution_artifacts: List[Dict[str, Any]] = []
        action_execution_payload: Dict[str, Any] = {
            "permission_mode": policy.permission_mode,
            "execution_policy": policy.execution_policy,
            "allow_desktop_action_execution": policy.allow_desktop_action_execution,
            "execute_actions_now": execute_actions_now,
            "action_candidate_detected": bool(action_candidate),
        }

        if action_candidate:
            execution_artifacts.append(
                {
                    "kind": "json",
                    "name": f"agent-s-sdk-action-{step_index:03d}.json",
                    "json": action_candidate,
                    "metadata": {"source": "agent-s-sdk", "step_index": step_index},
                }
            )
            if execute_actions_now and action_candidate.get("exec_code"):
                # 2026-06-04: action_type='mcp_call' 走 KaypalMcpClient (LLM 调 browser_* 工具)
                if action_candidate.get("action_type") == "mcp_call":
                    execution_result = _execute_mcp_action(action_candidate, self.context)
                else:
                    execution_result = self._execute_action_candidate(
                        action_candidate,
                        step_index,
                        policy,
                    )
                action_execution_payload["execution_result"] = execution_result
                execution_artifacts.append(
                    {
                        "kind": "json",
                        "name": f"agent-s-sdk-action-execution-{step_index:03d}.json",
                        "json": execution_result,
                        "metadata": {
                            "source": "agent-s-sdk",
                            "step_index": step_index,
                            "kind": "action-execution",
                        },
                    }
                )
                execution_note = (
                    "Agent-S action executed successfully."
                    if execution_result.get("status") == "executed"
                    else "Agent-S action execution was blocked."
                )
                execution_artifacts.append(
                    {
                        "kind": "text",
                        "name": f"agent-s-sdk-action-execution-{step_index:03d}.txt",
                        "text": (
                            f"{execution_note}\n"
                            f"permission_mode: {policy.permission_mode}\n"
                            f"execution_policy: {policy.execution_policy}\n"
                            f"action_type: {action_candidate.get('action_type')}\n"
                            f"target: {action_candidate.get('target')}\n"
                        ),
                        "metadata": {
                            "source": "agent-s-sdk",
                            "step_index": step_index,
                            "kind": "action-execution",
                        },
                    }
                )
            elif not policy.allow_desktop_action_execution:
                action_execution_payload["execution_result"] = {
                    "status": "planned_only",
                    "reason": "desktop action execution is disabled by permission mode",
                }
            else:
                action_execution_payload["execution_result"] = {
                    "status": "deferred",
                    "reason": "desktop action execution is waiting for approval",
                }

        return {
            "prediction_summary": prediction_summary,
            "step": {
                "step_index": step_index,
                "title": prediction_summary["title"],
                "summary": prediction_summary["summary"],
                "status": "completed",
                "screenshot_base64": screenshot_base64,
            },
            "action_candidate": action_candidate,
            "artifacts": [
                {
                    "kind": "json",
                    "name": f"agent-s-sdk-step-{step_index:03d}.json",
                    "json": prediction_summary["raw"],
                    "metadata": {"source": "agent-s-sdk", "step_index": step_index},
                },
                {
                    "kind": "screenshot",
                    "name": f"agent-s-sdk-step-{step_index:03d}.png",
                    "base64": screenshot_base64,
                    "metadata": {"source": "agent-s-sdk", "step_index": step_index},
                },
                {
                    "kind": "json",
                    "name": f"agent-s-sdk-policy-{step_index:03d}.json",
                    "json": action_execution_payload,
                    "metadata": {
                        "source": "agent-s-sdk",
                        "step_index": step_index,
                        "kind": "policy",
                    },
                },
                *execution_artifacts,
            ],
        }

    def _build_mcp_tool_brief(self) -> str:
        """
        2026-06-04: 把 playwright-mcp 暴露的 browser_* 工具列成简短说明,
        让 LLM 知道可以调 (生成的 mcp_call action 会被 _execute_mcp_action 处理).
        """
        try:
            from kaypal_mcp_client import get_mcp_client
            tools = get_mcp_client().list_tools()
        except Exception:
            return ""
        if not tools:
            return ""
        lines = [
            "## 浏览器自动化工具 (通过 MCP playwright-mcp)",
            "当你需要操作浏览器时, 可以在 action 里使用 `mcp_call` 类型, 格式:",
            "  {\"action_type\": \"mcp_call\", \"tool_name\": \"browser_navigate\", \"tool_args\": {\"url\": \"...\"}}",
            "可用工具 (前 10 个):",
        ]
        for t in tools[:10]:
            desc = (t.get("description") or "").replace("\n", " ")[:80]
            lines.append(f"  - `{t.get('name')}`: {desc}")
        if len(tools) > 10:
            lines.append(f"  ... 还有 {len(tools) - 10} 个工具")
        lines.append("\n典型流程: navigate -> snapshot (拿 a11y tree) -> click/type/fill -> screenshot")
        return "\n".join(lines)

    def _build_resume_instruction(
        self,
        pending: PendingApproval,
        comment: Optional[str],
        provider_state: Dict[str, Any],
    ) -> str:
        parts = [pending.instruction.strip()]
        checkpoint_summary = str(provider_state.get("checkpoint_summary") or "").strip()
        if checkpoint_summary:
            parts.extend(
                [
                    "",
                    "The previous desktop action candidate was approved by the user.",
                    f"Previous checkpoint summary: {checkpoint_summary}",
                ]
            )
        else:
            parts.extend(["", "The previous desktop action candidate was approved by the user."])

        if comment and comment.strip():
            parts.append(f"Approval comment: {comment.strip()}")

        parts.append("Continue from the current desktop state and produce the next safe GUI action.")
        return "\n".join(parts)

    def _get_sdk_loader(self) -> LoadedAgentSSdk:
        if self._sdk_loader is None:
            self._sdk_loader = _load_agent_s_sdk()
        return self._sdk_loader

    def _create_agent(
        self,
        sdk: LoadedAgentSSdk,
        api_key: str,
        model: str,
        provider: str,
    ) -> Any:
        if sdk.flavor == "official-s3":
            engine_params = {
                "engine_type": provider,
                "model": model,
                "api_key": api_key,
            }
            if self.context.settings.agent_s_sdk_base_url:
                engine_params["base_url"] = self.context.settings.agent_s_sdk_base_url

            grounding_engine = {
                "engine_type": self.context.settings.agent_s_sdk_ground_provider or provider,
                "model": self.context.settings.agent_s_sdk_ground_model or model,
                "grounding_width": self.context.settings.agent_s_sdk_grounding_width,
                "grounding_height": self.context.settings.agent_s_sdk_grounding_height,
                "api_key": self.context.settings.agent_s_sdk_ground_api_key or api_key,
            }
            if self.context.settings.agent_s_sdk_ground_url:
                grounding_engine["base_url"] = self.context.settings.agent_s_sdk_ground_url

            platform = self.context.settings.agent_s_sdk_platform or self._detect_platform()
            grounding_agent = sdk.grounding_class_or_engine(
                env=None,
                platform=platform,
                engine_params_for_generation=engine_params,
                engine_params_for_grounding=grounding_engine,
                width=self.context.settings.agent_s_sdk_grounding_width,
                height=self.context.settings.agent_s_sdk_grounding_height,
            )
            return sdk.agent_class(
                engine_params,
                grounding_agent,
                platform=platform,
                max_trajectory_length=max(1, self.context.settings.agent_s_sdk_max_steps),
                enable_reflection=True,
            )

        constructor_kwargs = {
            "engine_params": sdk.grounding_class_or_engine(
                model=model,
                api_key=api_key,
                base_url=self.context.settings.agent_s_sdk_base_url or None,
            ),
            "grounding_agent_model": model,
            "platform": self.context.settings.agent_s_sdk_platform or None,
            "action_space": self.context.settings.agent_s_sdk_action_space,
            "observation_type": self.context.settings.agent_s_sdk_observation_type,
            "search_engine": self.context.settings.agent_s_sdk_search_engine or provider,
        }
        constructor_kwargs = {
            key: value for key, value in constructor_kwargs.items() if value is not None
        }
        try:
            return sdk.agent_class(**constructor_kwargs)
        except TypeError as exc:
            raise RuntimeError(
                "Agent-S SDK constructor signature is incompatible with the current provider adapter"
            ) from exc

    def _predict(
        self,
        agent: Any,
        sdk: LoadedAgentSSdk,
        instruction: str,
        screenshot_bytes: bytes,
    ) -> Any:
        if sdk.flavor == "official-s3":
            observation = {"screenshot": screenshot_bytes}
            return agent.predict(instruction=instruction, observation=observation)
        return agent.predict(instruction)

    def _detect_platform(self) -> str:
        if sys.platform.startswith("win"):
            return "windows"
        if sys.platform == "darwin":
            return "darwin"
        return "linux"

    def _take_screenshot_bytes(self) -> bytes:
        try:
            pyautogui = importlib.import_module("pyautogui")
        except Exception as exc:
            raise RuntimeError(
                "Agent-S SDK s3 mode requires pyautogui for screenshots."
            ) from exc

        screenshot = pyautogui.screenshot()
        buffered = io.BytesIO()
        screenshot.save(buffered, format="PNG")
        return buffered.getvalue()

    def _execute_action_candidate(
        self,
        action_candidate: Dict[str, Any],
        step_index: int,
        policy: AgentSExecutionPolicy,
    ) -> Dict[str, Any]:
        exec_code = str(action_candidate.get("exec_code") or "").strip()
        if not exec_code:
            return {
                "status": "blocked",
                "reason": "missing exec_code",
                "step_index": step_index,
            }

        target = str(action_candidate.get("target") or "").strip()
        if policy.allowed_targets and target and target not in policy.allowed_targets:
            return {
                "status": "blocked",
                "reason": f"target {target!r} is not in the allowed target whitelist",
                "step_index": step_index,
                "target": target,
                "allowed_targets": list(policy.allowed_targets),
            }

        try:
            operations = _parse_supported_pyautogui_ops(exec_code)
        except Exception as exc:
            return {
                "status": "blocked",
                "reason": f"unsupported action candidate: {exc}",
                "step_index": step_index,
            }

        pyautogui = importlib.import_module("pyautogui")
        blocked_text_payload: Optional[Dict[str, Any]] = None
        for op_name, op_args in operations:
            if op_name != "typewrite":
                continue
            candidate_text = str(op_args[0]) if op_args else ""
            if not policy.allowed_text_inputs or candidate_text not in policy.allowed_text_inputs:
                blocked_text_payload = {
                    "status": "blocked",
                    "reason": "typewrite text is not in the allowed text input whitelist",
                    "step_index": step_index,
                    "target": action_candidate.get("target"),
                    "candidate_text": candidate_text,
                    "allowed_text_inputs": list(policy.allowed_text_inputs),
                }
                break

        if blocked_text_payload is not None:
            return blocked_text_payload

        executed_ops: List[Dict[str, Any]] = []
        for op_name, op_args in operations:
            if op_name == "sleep":
                delay = float(op_args[0])
                time.sleep(delay)
                executed_ops.append({"op": "sleep", "seconds": delay})
                continue

            operation = getattr(pyautogui, op_name, None)
            if not callable(operation):
                raise RuntimeError(f"pyautogui does not expose callable {op_name!r}")

            if op_name == "hotkey":
                keys = [str(arg) for arg in op_args if isinstance(arg, str)]
                if not keys:
                    raise RuntimeError("hotkey requires at least one key argument")
                operation(*keys)
                executed_ops.append({"op": op_name, "args": keys})
                continue

            if op_name == "typewrite":
                text = str(op_args[0]) if op_args else ""
                interval = None
                if len(op_args) > 1 and isinstance(op_args[1], (int, float)):
                    interval = float(op_args[1])
                if interval is not None:
                    operation(text, interval=interval)
                    executed_ops.append(
                        {"op": op_name, "args": [text], "kwargs": {"interval": interval}}
                    )
                else:
                    operation(text)
                    executed_ops.append({"op": op_name, "args": [text]})
                continue

            if op_name == "press":
                key = str(op_args[0]) if op_args else ""
                operation(key)
                executed_ops.append({"op": op_name, "args": [key]})
                continue

            operation(*op_args)
            executed_ops.append({"op": op_name, "args": list(op_args)})

        return {
            "status": "executed",
            "step_index": step_index,
            "op_count": len(executed_ops),
            "operations": executed_ops,
            "action_type": action_candidate.get("action_type"),
            "target": action_candidate.get("target"),
        }


def _create_real_provider(context: RunnerContext) -> Optional[RealProvider]:
    provider_name = context.settings.real_provider
    if provider_name == "external_http":
        if not context.settings.external_agent_base_url:
            return None
        return ExternalHttpProvider(context)
    if provider_name == "agent_s_sdk":
        return AgentSSdkProvider(context)
    return None


def _post_json(
    *,
    url: str,
    payload: Dict[str, Any],
    api_key: str,
    timeout_ms: int,
    error_prefix: str,
) -> Dict[str, Any]:
    request_bytes = json.dumps(payload).encode("utf-8")
    http_request = urllib_request.Request(
        url=url,
        data=request_bytes,
        method="POST",
        headers={
            "content-type": "application/json",
            **({"authorization": f"Bearer {api_key}"} if api_key else {}),
        },
    )

    try:
        with urllib_request.urlopen(
            http_request,
            timeout=max(1, timeout_ms // 1000),
        ) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib_error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{error_prefix} HTTP {exc.code}: {body}") from exc
    except urllib_error.URLError as exc:
        raise RuntimeError(f"{error_prefix} is unreachable: {exc}") from exc


def _load_agent_s_sdk() -> LoadedAgentSSdk:
    errors: List[str] = []

    # Official public README on 2026-05-20 uses the s3 entrypoints. Prefer them first.
    try:
        agent_module = importlib.import_module("gui_agents.s3.agents.agent_s")
        grounding_module = importlib.import_module("gui_agents.s3.agents.grounding")
        AgentS3 = getattr(agent_module, "AgentS3", None)
        OSWorldACI = getattr(grounding_module, "OSWorldACI", None)
        if AgentS3 is not None and OSWorldACI is not None:
            return LoadedAgentSSdk(
                flavor="official-s3",
                agent_class=AgentS3,
                grounding_class_or_engine=OSWorldACI,
            )
        errors.append("gui_agents.s3 modules loaded but AgentS3/OSWorldACI were missing")
    except Exception as exc:
        errors.append(f"s3 import failed: {exc}")

    # Backward-compatible fallback for earlier local installs we may encounter.
    try:
        graph_search_module = importlib.import_module("gui_agents.s1.core.GraphSearchAgent")
        engine_module = importlib.import_module("gui_agents.s1.utils.common_utils")
        GraphSearchAgent = getattr(graph_search_module, "GraphSearchAgent", None)
        engine_params = getattr(engine_module, "engine_params", None)
        if GraphSearchAgent is not None and engine_params is not None:
            return LoadedAgentSSdk(
                flavor="legacy-s1",
                agent_class=GraphSearchAgent,
                grounding_class_or_engine=engine_params,
            )
        errors.append("gui_agents.s1 modules loaded but GraphSearchAgent/engine_params were missing")
    except Exception as exc:
        errors.append(f"s1 import failed: {exc}")

    raise RuntimeError(
        "Agent-S SDK provider requires the gui_agents package with either the "
        "official s3 entrypoints or the legacy s1 compatibility modules. "
        "Install Agent-S first or switch KAYPAL_AGENT_S_REAL_PROVIDER=external_http. "
        f"Import attempts: {'; '.join(errors)}"
    )


def _normalize_agent_s_prediction(prediction: Any) -> Dict[str, Any]:
    if isinstance(prediction, dict):
        title = str(
            prediction.get("action")
            or prediction.get("name")
            or prediction.get("title")
            or "Agent-S SDK prediction"
        )
        summary = str(
            prediction.get("description")
            or prediction.get("summary")
            or prediction.get("thought")
            or prediction.get("reasoning")
            or title
        )
        return {"title": title, "summary": summary, "raw": prediction}

    if isinstance(prediction, (list, tuple)):
        primary_item = prediction[0] if prediction else None
        if isinstance(primary_item, dict):
            title = str(
                primary_item.get("action")
                or primary_item.get("name")
                or primary_item.get("title")
                or "Agent-S SDK prediction"
            )
            summary = str(
                primary_item.get("description")
                or primary_item.get("summary")
                or primary_item.get("thought")
                or primary_item.get("reasoning")
                or primary_item.get("plan")
                or title
            )
            return {"title": title, "summary": summary, "raw": {"items": list(prediction)}}

        payload = {"items": list(prediction)}
        return {
            "title": "Agent-S SDK prediction",
            "summary": json.dumps(payload, ensure_ascii=False),
            "raw": payload,
        }

    return {
        "title": "Agent-S SDK prediction",
        "summary": str(prediction),
        "raw": {"value": str(prediction)},
    }


def _resolve_execution_policy(request: RunSessionRequest) -> AgentSExecutionPolicy:
    metadata = request.metadata if isinstance(request.metadata, dict) else {}
    permission_mode = str(metadata.get("local_controller_permission_mode") or "restricted").strip()
    if permission_mode not in {"restricted", "custom", "full"}:
        permission_mode = "restricted"

    execution_policy = str(metadata.get("agent_s_execution_policy") or "").strip()
    allow_execution = bool(metadata.get("allow_desktop_action_execution"))

    if execution_policy not in {"plan_only", "approval_execute", "auto_execute"}:
        if permission_mode == "full":
            execution_policy = "auto_execute"
        elif permission_mode == "custom":
            execution_policy = "approval_execute"
        else:
            execution_policy = "plan_only"

    if permission_mode == "restricted":
        allow_execution = False
    elif permission_mode == "custom":
        allow_execution = True
    elif permission_mode == "full" and not allow_execution:
        allow_execution = True

    allowed_targets = _normalize_allowed_targets(metadata.get("allowed_desktop_action_targets"))
    allowed_text_inputs = _normalize_allowed_targets(metadata.get("allowed_desktop_text_inputs"))

    return AgentSExecutionPolicy(
        permission_mode=permission_mode,
        execution_policy=execution_policy,
        allow_desktop_action_execution=allow_execution
        and execution_policy in {"approval_execute", "auto_execute"},
        requires_approval_for_execution=execution_policy == "approval_execute",
        allowed_targets=allowed_targets,
        allowed_text_inputs=allowed_text_inputs,
    )


def _resolve_execution_policy_from_provider_state(
    provider_state: Dict[str, Any],
) -> AgentSExecutionPolicy:
    metadata_like = {
        "local_controller_permission_mode": provider_state.get("permission_mode"),
        "agent_s_execution_policy": provider_state.get("execution_policy"),
        "allow_desktop_action_execution": provider_state.get("allow_desktop_action_execution"),
        "allowed_desktop_action_targets": provider_state.get("allowed_targets"),
        "allowed_desktop_text_inputs": provider_state.get("allowed_text_inputs"),
    }
    request = RunSessionRequest(
        instruction="resume",
        metadata=metadata_like,
    )
    return _resolve_execution_policy(request)


def _extract_agent_s_action_candidate(raw_prediction: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw_prediction, dict):
        return None

    items = raw_prediction.get("items")
    if not isinstance(items, list) or not items:
        return None

    primary = items[0] if isinstance(items[0], dict) else None
    if not isinstance(primary, dict):
        return None

    exec_code = str(primary.get("exec_code") or "").strip()
    if not exec_code:
        return None

    target = ""
    plan_code = str(primary.get("plan_code") or "").strip()
    target_match = re.search(r'agent\.open\("([^"]+)"\)', plan_code)
    if target_match:
        target = target_match.group(1).strip()

    action_type = "pyautogui-script"
    if "hotkey" in exec_code and "typewrite" in exec_code and "press" in exec_code:
        action_type = "spotlight-open"

    return {
        "action_type": action_type,
        "target": target,
        "exec_code": exec_code,
        "plan": str(primary.get("plan") or "").strip(),
        "plan_code": plan_code,
        "source": "agent-s-sdk",
    }


# 2026-06-04: 让 Agent-S 通过 MCP 调浏览器 (microsoft/playwright-mcp)
# LLM 生成 mcp_call action (action_type='mcp_call') 时, 走 KaypalMcpClient.call_tool
def _execute_mcp_action(action_candidate: Dict[str, Any], context: RunnerContext) -> Dict[str, Any]:
    """
    执行 mcp_call action: Agent-S 通过 MCP 调浏览器工具
    action_candidate 期望有: tool_name, tool_args
    """
    from kaypal_mcp_client import get_mcp_client

    tool_name = str(action_candidate.get("tool_name") or "").strip()
    tool_args = action_candidate.get("tool_args") or {}
    if not tool_name:
        return {
            "status": "skipped",
            "message": "mcp_call action missing tool_name",
            "tool_name": tool_name,
        }

    try:
        client = get_mcp_client()
        result = client.call_tool(tool_name, tool_args)
        # 截取前 200 字符避免日志爆
        result_text = json.dumps(result, ensure_ascii=False)[:200]
        return {
            "status": "executed",
            "tool_name": tool_name,
            "tool_args": tool_args,
            "result": result,
            "result_text": result_text,
        }
    except Exception as exc:
        message = f"mcp_call {tool_name} failed: {exc}"
        logger.warning(message)
        return {
            "status": "failed",
            "tool_name": tool_name,
            "tool_args": tool_args,
            "message": message,
        }


def _parse_supported_pyautogui_ops(exec_code: str) -> List[Tuple[str, Tuple[Any, ...]]]:
    supported: List[Tuple[str, Tuple[Any, ...]]] = []
    statements = [segment.strip() for segment in exec_code.split(";") if segment.strip()]
    for statement in statements:
        if statement in {"import pyautogui", "import time"}:
            continue
        sleep_match = re.fullmatch(r"time\.sleep\(([\d.]+)\)", statement)
        if sleep_match:
            supported.append(("sleep", (float(sleep_match.group(1)),)))
            continue
        hotkey_match = re.fullmatch(
            r"pyautogui\.hotkey\((.+)\)",
            statement,
        )
        if hotkey_match:
            args = _parse_pyautogui_args(hotkey_match.group(1))
            if not args or not all(isinstance(arg, str) for arg in args[:-1]):
                raise RuntimeError(f"unsupported hotkey args: {statement}")
            supported.append(("hotkey", tuple(args)))
            continue
        typewrite_match = re.fullmatch(r"pyautogui\.typewrite\((.+)\)", statement)
        if typewrite_match:
            args = _parse_pyautogui_args(typewrite_match.group(1))
            if not args or not isinstance(args[0], str):
                raise RuntimeError(f"unsupported typewrite args: {statement}")
            supported.append(("typewrite", tuple(args)))
            continue
        press_match = re.fullmatch(r"pyautogui\.press\((.+)\)", statement)
        if press_match:
            args = _parse_pyautogui_args(press_match.group(1))
            if not args or not isinstance(args[0], str):
                raise RuntimeError(f"unsupported press args: {statement}")
            supported.append(("press", tuple(args)))
            continue
        raise RuntimeError(f"unsupported statement: {statement}")
    return supported


def _parse_pyautogui_args(raw_args: str) -> List[Any]:
    args: List[Any] = []
    for part in [segment.strip() for segment in raw_args.split(",") if segment.strip()]:
        if "=" in part:
            key, value = part.split("=", 1)
            key = key.strip()
            value = value.strip()
            if key == "interval":
                args.append(float(value))
                continue
            raise RuntimeError(f"unsupported keyword arg: {key}")
        if part.startswith(("'", '"')) and part.endswith(("'", '"')):
            args.append(part[1:-1])
            continue
        if re.fullmatch(r"[\d.]+", part):
            args.append(float(part))
            continue
        raise RuntimeError(f"unsupported arg: {part}")
    return args


def _normalize_allowed_targets(raw_value: Any) -> Tuple[str, ...]:
    if isinstance(raw_value, str):
        values = [segment.strip() for segment in raw_value.split(",") if segment.strip()]
        return tuple(values)
    if isinstance(raw_value, list):
        return tuple(
            str(item).strip() for item in raw_value if str(item).strip()
        )
    return ()
