from __future__ import annotations

import base64
import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from models import SessionArtifact, SessionEvent, SessionSummary


PLACEHOLDER_PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8"
    "/w8AAn8B9oNcamcAAAAASUVORK5CYII="
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class ArtifactStore:
    def __init__(self, root: Path) -> None:
        self._root = root
        self._lock = threading.RLock()
        self._artifacts: Dict[str, Dict[str, SessionArtifact]] = {}
        self._root.mkdir(parents=True, exist_ok=True)

    @property
    def root(self) -> Path:
        return self._root

    def create_session_layout(self, session_id: str) -> Path:
        with self._lock:
            session_dir = self._root / session_id
            (session_dir / "events").mkdir(parents=True, exist_ok=True)
            (session_dir / "runs").mkdir(parents=True, exist_ok=True)
            self._artifacts.setdefault(session_id, {})
            return session_dir

    def append_event(self, session_id: str, event: SessionEvent) -> SessionArtifact:
        session_dir = self.create_session_layout(session_id)
        event_path = session_dir / "events" / "events.jsonl"
        line = json.dumps(event.model_dump(), ensure_ascii=True, sort_keys=True)
        with self._lock:
            with event_path.open("a", encoding="utf-8") as handle:
                handle.write(line)
                handle.write("\n")
            return self._register_artifact(
                session_id=session_id,
                run_id=event.run_id,
                kind="json",
                path=event_path,
                metadata={"scope": "event-log"},
            )

    def write_request_artifact(
        self,
        session_id: str,
        run_id: str,
        payload: dict[str, Any],
    ) -> SessionArtifact:
        return self._write_json_artifact(
            session_id=session_id,
            run_id=run_id,
            name="request.json",
            payload=payload,
            kind="json",
        )

    def write_screenshot_artifact(
        self,
        session_id: str,
        run_id: str,
        *,
        step_index: int,
        label: str,
    ) -> SessionArtifact:
        run_dir = self._run_dir(session_id, run_id)
        path = run_dir / "screenshots" / f"step-{step_index:03d}-{label}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            path.write_bytes(PLACEHOLDER_PNG_BYTES)
            return self._register_artifact(
                session_id=session_id,
                run_id=run_id,
                kind="screenshot",
                path=path,
                metadata={
                    "step_index": step_index,
                    "placeholder": True,
                    "label": label,
                },
            )

    def write_binary_artifact(
        self,
        session_id: str,
        run_id: str,
        *,
        name: str,
        content: bytes,
        kind: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> SessionArtifact:
        run_dir = self._run_dir(session_id, run_id)
        path = run_dir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            path.write_bytes(content)
            return self._register_artifact(
                session_id=session_id,
                run_id=run_id,
                kind=kind,
                path=path,
                metadata=metadata or {},
            )

    def write_text_artifact(
        self,
        session_id: str,
        run_id: str,
        *,
        name: str,
        content: str,
        kind: str = "text",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> SessionArtifact:
        run_dir = self._run_dir(session_id, run_id)
        path = run_dir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            path.write_text(content, encoding="utf-8")
            return self._register_artifact(
                session_id=session_id,
                run_id=run_id,
                kind=kind,
                path=path,
                metadata=metadata or {},
            )

    def write_session_summary(self, summary: SessionSummary) -> SessionArtifact:
        return self._write_json_artifact(
            session_id=summary.session_id,
            run_id=summary.active_run_id,
            name="session-summary.json",
            payload=summary.model_dump(),
            kind="summary",
        )

    def list_artifacts(self, session_id: str) -> List[SessionArtifact]:
        with self._lock:
            entries = self._artifacts.get(session_id)
            if entries is None:
                return []
            artifacts = [artifact.model_copy(deep=True) for artifact in entries.values()]
            artifacts.sort(key=lambda artifact: (artifact.created_at, artifact.filename))
            return artifacts

    def _write_json_artifact(
        self,
        *,
        session_id: str,
        run_id: Optional[str],
        name: str,
        payload: Dict[str, Any],
        kind: str,
    ) -> SessionArtifact:
        if run_id:
            base_dir = self._run_dir(session_id, run_id)
        else:
            base_dir = self.create_session_layout(session_id)
        path = base_dir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            path.write_text(json.dumps(payload, indent=2, ensure_ascii=True, sort_keys=True), encoding="utf-8")
            return self._register_artifact(
                session_id=session_id,
                run_id=run_id,
                kind=kind,
                path=path,
                metadata={},
            )

    def write_json_artifact(
        self,
        session_id: str,
        run_id: Optional[str],
        *,
        name: str,
        payload: Dict[str, Any],
        kind: str = "json",
    ) -> SessionArtifact:
        return self._write_json_artifact(
            session_id=session_id,
            run_id=run_id,
            name=name,
            payload=payload,
            kind=kind,
        )

    def _run_dir(self, session_id: str, run_id: str) -> Path:
        session_dir = self.create_session_layout(session_id)
        run_dir = session_dir / "runs" / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        return run_dir

    def _register_artifact(
        self,
        *,
        session_id: str,
        run_id: Optional[str],
        kind: str,
        path: Path,
        metadata: Dict[str, Any],
    ) -> SessionArtifact:
        key = str(path.resolve())
        existing = self._artifacts.setdefault(session_id, {}).get(key)
        if existing is not None:
            existing.size_bytes = path.stat().st_size
            existing.metadata = dict(metadata)
            return existing.model_copy(deep=True)
        artifact = SessionArtifact(
            artifact_id=f"art_{uuid.uuid4().hex[:12]}",
            session_id=session_id,
            run_id=run_id,
            kind=kind,
            filename=path.name,
            path=key,
            created_at=_utc_now(),
            size_bytes=path.stat().st_size,
            metadata=dict(metadata),
        )
        self._artifacts[session_id][key] = artifact
        return artifact.model_copy(deep=True)
