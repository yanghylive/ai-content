#!/usr/bin/env python3
"""Real on-machine sidecar smoke with a local stub Agent-S SDK and real pyautogui actions."""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict


ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / ".venv" / "bin" / "python"
TOKEN = "local-live-sidecar-token"
PORT = 17782
BASE = f"http://127.0.0.1:{PORT}"
WORK_DIR = ROOT / "data-smoke-sdk-local-live"
STUB_ROOT = WORK_DIR / "stub-site"
PYCACHE_DIR = ROOT / ".tmp" / "pycache-local-live"


PNG_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6RMx0AAAAASUVORK5CYII="
)


def pass_log(message: str) -> None:
    print(f"[PASS] {message}")


def fail(message: str) -> int:
    print(f"[FAIL] {message}")
    return 1


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def prepare_stub_modules() -> None:
    shutil.rmtree(STUB_ROOT, ignore_errors=True)
    STUB_ROOT.mkdir(parents=True, exist_ok=True)

    write_file(STUB_ROOT / "gui_agents/__init__.py", "# local live stub package\n")
    write_file(STUB_ROOT / "gui_agents/s3/__init__.py", "# local live stub package\n")
    write_file(STUB_ROOT / "gui_agents/s3/agents/__init__.py", "# local live stub package\n")
    write_file(
        STUB_ROOT / "gui_agents/s3/agents/grounding.py",
        """
from __future__ import annotations

class OSWorldACI:
    def __init__(self, **kwargs) -> None:
        self.kwargs = kwargs
""".strip()
        + "\n",
    )
    write_file(
        STUB_ROOT / "gui_agents/s3/agents/agent_s.py",
        """
from __future__ import annotations

class AgentS3:
    def __init__(self, engine_params, grounding_agent, **kwargs) -> None:
        self.engine_params = engine_params
        self.grounding_agent = grounding_agent
        self.kwargs = kwargs
        self.calls = 0

    def predict(self, *, instruction, observation):
        self.calls += 1
        exec_code = "import pyautogui; pyautogui.hotkey('command', 'space'); pyautogui.typewrite('Finder', interval=0.05); pyautogui.press('enter')"
        return [
            {
                "title": f"Local live stub step {self.calls}",
                "summary": f"observed screenshot bytes={len(observation.get('screenshot', b''))} for: {instruction}",
                "action": "open-finder-via-spotlight",
                "observation_keys": sorted(observation.keys()),
                "exec_code": exec_code,
                "plan": "Open Finder via Spotlight.",
                "plan_code": "agent.open(\\"Finder\\")",
            },
            [exec_code],
        ]
""".strip()
        + "\n",
    )


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
        except Exception as exc:
            last_error = exc
        time.sleep(0.5)
    raise RuntimeError(f"sidecar did not become healthy: {last_error}")


def main() -> int:
    prepare_stub_modules()
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    (WORK_DIR / "artifacts").mkdir(parents=True, exist_ok=True)
    sidecar_log = (WORK_DIR / "sidecar.log").open("w", encoding="utf-8")

    env = os.environ.copy()
    python_path_parts = [str(STUB_ROOT)]
    if env.get("PYTHONPATH"):
        python_path_parts.append(env["PYTHONPATH"])
    env.update(
        {
            "PYTHONPATH": os.pathsep.join(python_path_parts),
            "PYTHONPYCACHEPREFIX": str(PYCACHE_DIR),
            "KAYPAL_AGENT_S_RUNNER_MODE": "real",
            "KAYPAL_AGENT_S_REAL_PROVIDER": "agent_s_sdk",
            "KAYPAL_AGENT_S_PORT": str(PORT),
            "KAYPAL_AGENT_S_TOKEN": TOKEN,
            "KAYPAL_AGENT_S_ARTIFACT_ROOT": str(WORK_DIR / "artifacts"),
            "KAYPAL_AGENT_S_SDK_API_KEY": "local-live-stub-key",
            "KAYPAL_AGENT_S_SDK_MODEL_PROVIDER": "openai",
            "KAYPAL_AGENT_S_SDK_MODEL": "gpt-4o",
            "KAYPAL_AGENT_S_SDK_MAX_STEPS": "1",
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
        pass_log("sidecar healthy in local-live real/agent_s_sdk mode")

        created = request_json(
            "POST",
            f"{BASE}/sessions",
            {
                "session_name": "agent-s-sdk-local-live",
                "task_type": "desktop.gui.visual.real",
            },
        )
        session_id = created["session"]["session_id"]
        pass_log(f"created session {session_id}")

        accepted = request_json(
            "POST",
            f"{BASE}/sessions/{session_id}/run",
            {
                "instruction": "Observe the current desktop and open Finder via Spotlight if allowed.",
                "risk_level": "medium",
                "requires_approval": False,
                "metadata": {
                    "smoke": "agent-s-sdk-sidecar-local-live",
                    "local_controller_permission_mode": "full",
                    "allowed_desktop_action_targets": ["Finder"],
                },
            },
        )
        run_id = accepted["run_id"]
        pass_log(f"accepted run {run_id}")

        status_value = ""
        deadline = time.time() + 45
        while time.time() < deadline:
            session_payload = request_json("GET", f"{BASE}/sessions/{session_id}")
            status_value = session_payload.get("status", "")
            if status_value in {"completed", "failed", "waiting_approval", "cancelled"}:
                break
            time.sleep(1.0)

        if status_value != "completed":
            return fail(f"expected completed session, got {status_value!r}")
        pass_log("local-live session completed")

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
            "agent-s-sdk-policy-001.json",
            "agent-s-sdk-action-001.json",
            "agent-s-sdk-action-execution-001.json",
            "step-001-external-screen.png",
        }
        missing_files = sorted(required_files - artifact_names)
        if missing_files:
            return fail(f"missing expected artifacts: {missing_files}")

        execution_artifact_path = (
            WORK_DIR
            / "artifacts"
            / session_id
            / "runs"
            / run_id
            / "agent-s-sdk-action-execution-001.json"
        )
        execution_payload = json.loads(execution_artifact_path.read_text(encoding="utf-8"))
        if execution_payload.get("status") != "executed":
            return fail(f"expected executed action artifact, got {execution_payload!r}")
        if execution_payload.get("target") != "Finder":
            return fail(f"expected Finder target, got {execution_payload.get('target')!r}")
        pass_log("local-live action execution artifact validated")

        pass_log("local-live events and artifacts validated")
        return 0
    finally:
        if proc.poll() is None:
            proc.send_signal(signal.SIGINT)
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
        sidecar_log.close()


if __name__ == "__main__":
    raise SystemExit(main())
