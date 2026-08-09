#!/usr/bin/env python3
"""End-to-end live smoke for the sidecar HTTP run path using agent_s_sdk."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict


ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parents[1]
PYTHON = ROOT / ".venv" / "bin" / "python"
TOKEN = "live-sidecar-token"
PORT = 17781
BASE = f"http://127.0.0.1:{PORT}"
WORK_DIR = ROOT / "data-smoke-sdk-live"


def _load_dotenv_local() -> None:
    env_path = REPO_ROOT / ".env.local"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def pass_log(message: str) -> None:
    print(f"[PASS] {message}")


def fail(message: str) -> int:
    print(f"[FAIL] {message}")
    return 1


def request_json(method: str, url: str, payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    data = None
    headers = {"x-kaypal-agent-s-token": TOKEN}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["content-type"] = "application/json"
    req = urllib.request.Request(url=url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8")
    return json.loads(body) if body else {}


def wait_for_health(deadline: float) -> Dict[str, Any]:
    last_error = None
    while time.time() < deadline:
        try:
            payload = request_json("GET", f"{BASE}/healthz")
            if payload.get("status") == "ok":
                return payload
        except Exception as exc:  # pragma: no cover - smoke script
            last_error = exc
        time.sleep(0.5)
    raise RuntimeError(f"sidecar did not become healthy: {last_error}")


def choose_api_key() -> str:
    return (
        os.environ.get("KAYPAL_AGENT_S_SDK_API_KEY")
        or os.environ.get("DASHSCOPE_API_KEY")
        or os.environ.get("ARK_API_KEY")
        or os.environ.get("VOLCENGINE_API_KEY")
        or ""
    )


def main() -> int:
    _load_dotenv_local()

    api_key = choose_api_key()
    if not api_key:
        return fail("no usable API key found for agent_s_sdk sidecar live smoke")

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    (WORK_DIR / "artifacts").mkdir(parents=True, exist_ok=True)
    sidecar_log = (WORK_DIR / "sidecar.log").open("w", encoding="utf-8")

    env = os.environ.copy()
    env.update(
        {
            "KAYPAL_AGENT_S_RUNNER_MODE": "real",
            "KAYPAL_AGENT_S_REAL_PROVIDER": "agent_s_sdk",
            "KAYPAL_AGENT_S_PORT": str(PORT),
            "KAYPAL_AGENT_S_TOKEN": TOKEN,
            "KAYPAL_AGENT_S_ARTIFACT_ROOT": str(WORK_DIR / "artifacts"),
            "KAYPAL_AGENT_S_SDK_API_KEY": api_key,
            "KAYPAL_AGENT_S_SDK_MODEL_PROVIDER": env.get(
                "KAYPAL_AGENT_S_SDK_MODEL_PROVIDER", "openai"
            ),
            "KAYPAL_AGENT_S_SDK_MODEL": env.get(
                "KAYPAL_AGENT_S_SDK_MODEL", "qwen-vl-max-latest"
            ),
            "KAYPAL_AGENT_S_SDK_BASE_URL": env.get(
                "KAYPAL_AGENT_S_SDK_BASE_URL",
                env.get(
                    "DASHSCOPE_BASE_URL",
                    "https://dashscope.aliyuncs.com/compatible-mode/v1",
                ),
            ),
            "KAYPAL_AGENT_S_SDK_MAX_STEPS": "1",
            "KAYPAL_AGENT_S_SDK_GROUND_PROVIDER": env.get(
                "KAYPAL_AGENT_S_SDK_GROUND_PROVIDER",
                env.get("KAYPAL_AGENT_S_SDK_MODEL_PROVIDER", "openai"),
            ),
            "KAYPAL_AGENT_S_SDK_GROUND_MODEL": env.get(
                "KAYPAL_AGENT_S_SDK_GROUND_MODEL",
                env.get("KAYPAL_AGENT_S_SDK_MODEL", "qwen-vl-max-latest"),
            ),
            "KAYPAL_AGENT_S_SDK_GROUND_URL": env.get(
                "KAYPAL_AGENT_S_SDK_GROUND_URL",
                env.get(
                    "KAYPAL_AGENT_S_SDK_BASE_URL",
                    env.get(
                        "DASHSCOPE_BASE_URL",
                        "https://dashscope.aliyuncs.com/compatible-mode/v1",
                    ),
                ),
            ),
        }
    )

    proc = subprocess.Popen(
        [str(PYTHON), "main.py"],
        cwd=str(ROOT),
        stdout=sidecar_log,
        stderr=subprocess.STDOUT,
        env=env,
    )
    try:
        health = wait_for_health(time.time() + 45)
        if health.get("runner_mode") != "real":
            return fail(f"expected runner_mode=real, got {health.get('runner_mode')!r}")
        if health.get("real_provider") != "agent_s_sdk":
            return fail(
                f"expected real_provider=agent_s_sdk, got {health.get('real_provider')!r}"
            )
        pass_log("sidecar healthy in real/agent_s_sdk mode")

        created = request_json(
            "POST",
            f"{BASE}/sessions",
            {"session_name": "agent-s-sdk-live", "task_type": "desktop.gui.visual.real"},
        )
        session_id = created["session"]["session_id"]
        pass_log(f"created session {session_id}")

        accepted = request_json(
            "POST",
            f"{BASE}/sessions/{session_id}/run",
            {
                "instruction": "Observe the current desktop and return the next safe GUI action. Do not click automatically.",
                "risk_level": "medium",
                "requires_approval": False,
                "metadata": {"smoke": "agent-s-sdk-sidecar-live"},
            },
        )
        run_id = accepted["run_id"]
        pass_log(f"accepted run {run_id}")

        status_value = ""
        session_payload: Dict[str, Any] = {}
        deadline = time.time() + 120
        while time.time() < deadline:
            session_payload = request_json("GET", f"{BASE}/sessions/{session_id}")
            status_value = session_payload.get("status", "")
            if status_value in {"completed", "failed", "waiting_approval", "cancelled"}:
                break
            time.sleep(1.0)

        if status_value != "completed":
            return fail(f"expected completed session, got {status_value!r}")
        pass_log("session completed")

        events = request_json("GET", f"{BASE}/sessions/{session_id}/events?after_seq=0")
        artifacts = request_json("GET", f"{BASE}/sessions/{session_id}/artifacts")
        event_types = {event["event_type"] for event in events["events"]}
        artifact_names = {artifact["filename"] for artifact in artifacts["artifacts"]}

        required_events = {
            "session_started",
            "step_started",
            "screenshot_captured",
            "step_completed",
            "artifact_captured",
            "run_completed",
        }
        missing_events = sorted(required_events - event_types)
        if missing_events:
            return fail(f"missing expected events: {missing_events}")

        required_files = {
            "external-agent-response.json",
            "agent-s-sdk-step-001.json",
            "agent-s-sdk-step-001.png",
            "step-001-external-screen.png",
        }
        missing_files = sorted(required_files - artifact_names)
        if missing_files:
            return fail(f"missing expected artifacts: {missing_files}")

        pass_log("events and artifacts validated")
        approval_created = request_json(
            "POST",
            f"{BASE}/sessions",
            {
                "session_name": "agent-s-sdk-live-approval",
                "task_type": "desktop.gui.visual.real",
            },
        )
        approval_session_id = approval_created["session"]["session_id"]
        pass_log(f"created approval session {approval_session_id}")

        approval_accepted = request_json(
            "POST",
            f"{BASE}/sessions/{approval_session_id}/run",
            {
                "instruction": "Observe the current desktop, propose the next safe GUI action, then pause for approval before continuing.",
                "risk_level": "high",
                "requires_approval": True,
                "metadata": {"smoke": "agent-s-sdk-sidecar-live-approval"},
            },
        )
        approval_run_id = approval_accepted["run_id"]
        pass_log(f"accepted approval-gated run {approval_run_id}")

        approval_status = ""
        approval_payload: Dict[str, Any] = {}
        deadline = time.time() + 120
        while time.time() < deadline:
            approval_payload = request_json("GET", f"{BASE}/sessions/{approval_session_id}")
            approval_status = approval_payload.get("status", "")
            if approval_status in {"waiting_approval", "failed", "completed", "cancelled"}:
                break
            time.sleep(1.0)

        if approval_status != "waiting_approval":
            return fail(f"expected waiting_approval session, got {approval_status!r}")
        pass_log("approval-gated session paused for approval")

        approval_decision = request_json(
            "POST",
            f"{BASE}/sessions/{approval_session_id}/approval",
            {"decision": "approved", "comment": "Approved from live sidecar smoke"},
        )
        if approval_decision.get("status") not in {"running", "completed"}:
            return fail(
                f"unexpected approval response status: {approval_decision.get('status')!r}"
            )
        pass_log("approval decision accepted")

        approval_status = ""
        deadline = time.time() + 120
        while time.time() < deadline:
            approval_payload = request_json("GET", f"{BASE}/sessions/{approval_session_id}")
            approval_status = approval_payload.get("status", "")
            if approval_status in {"completed", "failed", "cancelled"}:
                break
            time.sleep(1.0)

        if approval_status != "completed":
            return fail(f"expected resumed approval session to complete, got {approval_status!r}")
        pass_log("approval-gated session resumed and completed")

        approval_events = request_json(
            "GET",
            f"{BASE}/sessions/{approval_session_id}/events?after_seq=0",
        )
        approval_artifacts = request_json(
            "GET",
            f"{BASE}/sessions/{approval_session_id}/artifacts",
        )
        approval_event_types = {event["event_type"] for event in approval_events["events"]}
        approval_artifact_names = {
            artifact["filename"] for artifact in approval_artifacts["artifacts"]
        }

        required_approval_events = {
            "approval_required",
            "approval_granted",
            "step_completed",
            "run_completed",
        }
        missing_approval_events = sorted(required_approval_events - approval_event_types)
        if missing_approval_events:
            return fail(f"missing approval-resume events: {missing_approval_events}")

        required_approval_files = {
            "external-agent-approval-response.json",
            "agent-s-sdk-step-002.json",
            "agent-s-sdk-post-approval.txt",
        }
        missing_approval_files = sorted(required_approval_files - approval_artifact_names)
        if missing_approval_files:
            return fail(f"missing approval-resume artifacts: {missing_approval_files}")

        pass_log("approval resume events and artifacts validated")

        execute_created = request_json(
            "POST",
            f"{BASE}/sessions",
            {
                "session_name": "agent-s-sdk-live-execute",
                "task_type": "desktop.gui.visual.real",
            },
        )
        execute_session_id = execute_created["session"]["session_id"]
        pass_log(f"created execute session {execute_session_id}")

        execute_accepted = request_json(
            "POST",
            f"{BASE}/sessions/{execute_session_id}/run",
            {
                "instruction": (
                    "Observe the current desktop and propose a safe next GUI action. "
                    "If the best next action is to open Finder, you may proceed."
                ),
                "risk_level": "medium",
                "requires_approval": False,
                "metadata": {
                    "smoke": "agent-s-sdk-sidecar-live-execute",
                    "local_controller_permission_mode": "full",
                    "allowed_desktop_action_targets": ["Finder"],
                    "allowed_desktop_text_inputs": ["Finder"],
                },
            },
        )
        execute_run_id = execute_accepted["run_id"]
        pass_log(f"accepted execute run {execute_run_id}")

        execute_status = ""
        deadline = time.time() + 120
        while time.time() < deadline:
            execute_payload = request_json("GET", f"{BASE}/sessions/{execute_session_id}")
            execute_status = execute_payload.get("status", "")
            if execute_status in {"completed", "failed", "waiting_approval", "cancelled"}:
                break
            time.sleep(1.0)

        if execute_status != "completed":
            return fail(f"expected execute session to complete, got {execute_status!r}")
        pass_log("execute session completed")

        execute_artifacts = request_json(
            "GET",
            f"{BASE}/sessions/{execute_session_id}/artifacts",
        )
        execute_artifact_names = {
            artifact["filename"] for artifact in execute_artifacts["artifacts"]
        }
        required_execute_files = {
            "agent-s-sdk-policy-001.json",
            "agent-s-sdk-action-001.json",
            "agent-s-sdk-action-execution-001.json",
        }
        missing_execute_files = sorted(required_execute_files - execute_artifact_names)
        if missing_execute_files:
            return fail(f"missing execute artifacts: {missing_execute_files}")

        execute_result_artifact = next(
            artifact
            for artifact in execute_artifacts["artifacts"]
            if artifact["filename"] == "agent-s-sdk-action-execution-001.json"
        )
        execute_result = json.loads(
            Path(execute_result_artifact["path"]).read_text(encoding="utf-8")
        )
        if execute_result.get("status") != "executed":
            return fail(
                "expected action execution artifact to report executed status, "
                f"got {execute_result.get('status')!r}"
            )
        pass_log("full-access execution artifact validated")

        print("[PASS] agent_s_sdk sidecar live smoke completed")
        return 0
    finally:
        if proc.poll() is None:
            proc.send_signal(signal.SIGTERM)
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
        sidecar_log.close()


if __name__ == "__main__":
    sys.exit(main())
