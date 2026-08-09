from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from models import CreateSessionRequest, SessionEvent, SessionSummary


TERMINAL_STATUSES = {"completed", "failed", "cancelled"}


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class SessionNotFoundError(KeyError):
    pass


class SessionConflictError(RuntimeError):
    pass


class SessionStore:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._sessions: Dict[str, SessionSummary] = {}
        self._events: Dict[str, List[SessionEvent]] = {}

    def create_session(self, request: CreateSessionRequest) -> SessionSummary:
        with self._lock:
            now = _utc_now()
            session_id = f"ags_{uuid.uuid4().hex[:12]}"
            summary = SessionSummary(
                session_id=session_id,
                session_name=request.session_name,
                task_type=request.task_type,
                status="idle",
                created_at=now,
                updated_at=now,
                metadata=dict(request.metadata),
                labels=list(request.labels),
            )
            self._sessions[session_id] = summary
            self._events[session_id] = []
            return summary.model_copy(deep=True)

    def begin_run(
        self,
        session_id: str,
        run_id: str,
        *,
        task_type: Optional[str],
        metadata: Dict[str, Any],
    ) -> SessionSummary:
        with self._lock:
            summary = self._require_session(session_id)
            if summary.status == "running":
                raise SessionConflictError(f"session {session_id} is already running")
            if summary.status == "waiting_approval":
                raise SessionConflictError(f"session {session_id} is waiting for approval")
            summary.run_count += 1
            summary.active_run_id = run_id
            summary.status = "running"
            summary.completed_at = None
            summary.cancellation_requested = False
            summary.last_error = None
            if task_type:
                summary.task_type = task_type
            if metadata:
                merged = dict(summary.metadata)
                merged.update(metadata)
                summary.metadata = merged
            summary.updated_at = _utc_now()
            return summary.model_copy(deep=True)

    def get_session(self, session_id: str) -> SessionSummary:
        with self._lock:
            return self._require_session(session_id).model_copy(deep=True)

    def list_events(self, session_id: str, after_seq: int = 0) -> List[SessionEvent]:
        with self._lock:
            self._require_session(session_id)
            return [
                event.model_copy(deep=True)
                for event in self._events[session_id]
                if event.seq > after_seq
            ]

    def append_event(
        self,
        session_id: str,
        *,
        event_type: str,
        status: str,
        run_id: Optional[str] = None,
        message: Optional[str] = None,
        step_index: Optional[int] = None,
        artifact_id: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
    ) -> SessionEvent:
        with self._lock:
            summary = self._require_session(session_id)
            event_list = self._events[session_id]
            event = SessionEvent(
                seq=len(event_list) + 1,
                session_id=session_id,
                run_id=run_id,
                event_type=event_type,
                status=status,
                created_at=_utc_now(),
                message=message,
                step_index=step_index,
                artifact_id=artifact_id,
                payload=payload or {},
            )
            event_list.append(event)
            summary.status = status
            summary.last_event_seq = event.seq
            summary.updated_at = event.created_at
            if status in TERMINAL_STATUSES:
                summary.completed_at = event.created_at
                summary.active_run_id = None
            return event.model_copy(deep=True)

    def request_cancel(self, session_id: str) -> SessionSummary:
        with self._lock:
            summary = self._require_session(session_id)
            if summary.status not in TERMINAL_STATUSES:
                summary.cancellation_requested = True
                summary.updated_at = _utc_now()
            return summary.model_copy(deep=True)

    def is_cancellation_requested(self, session_id: str) -> bool:
        with self._lock:
            return self._require_session(session_id).cancellation_requested

    def clear_cancellation_requested(self, session_id: str) -> SessionSummary:
        with self._lock:
            summary = self._require_session(session_id)
            summary.cancellation_requested = False
            summary.updated_at = _utc_now()
            return summary.model_copy(deep=True)

    def resolve_waiting_approval(
        self,
        session_id: str,
        *,
        decision: str,
        comment: Optional[str] = None,
    ) -> SessionSummary:
        with self._lock:
            summary = self._require_session(session_id)
            if summary.status != "waiting_approval":
                raise SessionConflictError(f"session {session_id} is not waiting for approval")

            summary.cancellation_requested = False
            if decision == "approved":
                summary.status = "completed"
                summary.last_error = None
            elif decision == "rejected":
                summary.status = "failed"
                summary.last_error = comment or "approval rejected"
            else:
                raise SessionConflictError(f"unsupported approval decision: {decision}")

            summary.updated_at = _utc_now()
            summary.completed_at = summary.updated_at
            summary.active_run_id = None
            return summary.model_copy(deep=True)

    def mark_last_error(self, session_id: str, error_message: str) -> SessionSummary:
        with self._lock:
            summary = self._require_session(session_id)
            summary.last_error = error_message
            summary.updated_at = _utc_now()
            return summary.model_copy(deep=True)

    def increment_artifact_count(self, session_id: str) -> SessionSummary:
        with self._lock:
            summary = self._require_session(session_id)
            summary.artifact_count += 1
            summary.updated_at = _utc_now()
            return summary.model_copy(deep=True)

    def set_artifact_count(self, session_id: str, artifact_count: int) -> SessionSummary:
        with self._lock:
            summary = self._require_session(session_id)
            summary.artifact_count = max(0, artifact_count)
            summary.updated_at = _utc_now()
            return summary.model_copy(deep=True)

    def counts(self) -> Tuple[int, int]:
        with self._lock:
            session_count = len(self._sessions)
            running_count = sum(1 for session in self._sessions.values() if session.status == "running")
            return session_count, running_count

    def _require_session(self, session_id: str) -> SessionSummary:
        summary = self._sessions.get(session_id)
        if summary is None:
            raise SessionNotFoundError(f"session {session_id} was not found")
        return summary
