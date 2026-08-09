#!/usr/bin/env python3
"""Local mock external GUI agent for real-mode sidecar verification."""

from __future__ import annotations

import base64
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict


PLACEHOLDER_PNG_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8"
    "/w8AAn8B9oNcamcAAAAASUVORK5CYII="
)


def _build_response(payload: Dict[str, Any]) -> Dict[str, Any]:
    session = payload.get("session") if isinstance(payload.get("session"), dict) else {}
    instruction = str(payload.get("instruction") or "No instruction provided")
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    requires_approval = bool(payload.get("requires_approval"))
    fail_run = bool(metadata.get("fail_run"))

    steps = [
        {
            "step_index": 1,
            "title": "Observe desktop state",
            "summary": "Captured the current desktop context for GUI grounding.",
            "status": "completed",
            "screenshot_base64": PLACEHOLDER_PNG_BASE64,
            "observed_window": metadata.get("window_title", "WeChat"),
        },
        {
            "step_index": 2,
            "title": "Plan next GUI action",
            "summary": f"Prepared a safe next action for instruction: {instruction}",
            "status": "failed" if fail_run else "completed",
            "decision": metadata.get("decision", "draft_reply"),
        },
    ]

    artifacts = [
        {
            "kind": "text",
            "name": "external-agent-summary.txt",
            "text": (
                "Mock external agent executed a desktop GUI plan.\n"
                f"session_id={session.get('session_id', '')}\n"
                f"run_id={session.get('run_id', '')}\n"
                f"instruction={instruction}\n"
            ),
            "metadata": {"source": "mock-external-agent"},
        },
        {
            "kind": "json",
            "name": "external-agent-plan.json",
            "json": {
                "task_type": session.get("task_type"),
                "risk_level": payload.get("risk_level"),
                "requires_approval": requires_approval,
                "metadata": metadata,
            },
            "metadata": {"source": "mock-external-agent"},
        },
        {
            "kind": "screenshot",
            "name": "external-agent-final-screen.png",
            "base64": PLACEHOLDER_PNG_BASE64,
            "metadata": {"source": "mock-external-agent", "label": "final"},
        },
    ]

    if fail_run:
        return {
            "status": "failed",
            "summary": "Mock external agent failed the run on request.",
            "steps": steps,
            "artifacts": artifacts,
            "requires_user_confirmation": False,
        }

    if requires_approval:
        return {
            "status": "waiting_approval",
            "summary": "Mock external agent paused for user confirmation.",
            "steps": steps,
            "artifacts": artifacts,
            "requires_user_confirmation": True,
            "approval_token": f"approval-token-{session.get('run_id', 'unknown')}",
            "checkpoint_id": "checkpoint-1",
            "approval_resume_endpoint": "/approval",
        }

    return {
        "status": "completed",
        "summary": "Mock external agent completed the GUI task successfully.",
        "steps": steps,
        "artifacts": artifacts,
        "requires_user_confirmation": False,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "MockExternalAgent/0.1"

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/healthz":
            self._send_json(200, {"status": "ok", "service": "mock-external-agent"})
            return
        self._send_json(404, {"detail": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path not in {"/run", "/approval"}:
            self._send_json(404, {"detail": "not found"})
            return

        length = int(self.headers.get("content-length", "0"))
        raw_body = self.rfile.read(length) if length > 0 else b"{}"
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            self._send_json(400, {"detail": "invalid json"})
            return

        if self.path == "/approval":
            payload_dict = payload if isinstance(payload, dict) else {}
            session = payload_dict.get("session") if isinstance(payload_dict.get("session"), dict) else {}
            response = {
                "status": "completed",
                "summary": "Mock external agent resumed after approval and completed successfully.",
                "steps": [
                    {
                        "step_index": 3,
                        "title": "Resume GUI execution",
                        "summary": "Resumed desktop plan after approval.",
                        "status": "completed",
                        "screenshot_base64": PLACEHOLDER_PNG_BASE64,
                        "checkpoint_id": payload_dict.get("checkpoint_id"),
                    }
                ],
                "artifacts": [
                    {
                        "kind": "text",
                        "name": "external-agent-post-approval.txt",
                        "text": (
                            "Mock external agent resumed after approval.\n"
                            f"session_id={session.get('session_id', '')}\n"
                            f"run_id={session.get('run_id', '')}\n"
                        ),
                        "metadata": {"source": "mock-external-agent", "phase": "post-approval"},
                    }
                ],
                "requires_user_confirmation": False,
            }
        else:
            response = _build_response(payload if isinstance(payload, dict) else {})
        self._send_json(200, response)

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _send_json(self, code: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    host = os.environ.get("MOCK_EXTERNAL_AGENT_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = int(os.environ.get("MOCK_EXTERNAL_AGENT_PORT", "18888"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"mock external agent listening on http://{host}:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
