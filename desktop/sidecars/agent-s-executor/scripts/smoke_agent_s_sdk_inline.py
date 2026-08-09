#!/usr/bin/env python3
"""Inline smoke for the Agent-S SDK adapter without opening a TCP port."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
WORK_DIR = ROOT / "data-smoke-sdk-inline"
STUB_ROOT = WORK_DIR / "stub-site"
PYCACHE_DIR = ROOT / ".tmp" / "pycache-inline"


PNG_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6RMx0AAAAASUVORK5CYII="
)


def ensure(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)
    print(f"[PASS] {message}")


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def prepare_stub_modules() -> None:
    shutil.rmtree(WORK_DIR, ignore_errors=True)
    STUB_ROOT.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(ROOT))

    write_file(
        STUB_ROOT / "pyautogui.py",
        f"""
from __future__ import annotations
import base64
import io

OPS = []

class _FakeImage:
    def save(self, stream: io.BytesIO, format: str = "PNG") -> None:
        stream.write(base64.b64decode("{PNG_BASE64}"))

def screenshot() -> _FakeImage:
    return _FakeImage()

def hotkey(*args):
    OPS.append(["hotkey", list(args)])

def typewrite(*args):
    OPS.append(["typewrite", list(args)])

def press(*args):
    OPS.append(["press", list(args)])
""".strip()
        + "\n",
    )

    write_file(STUB_ROOT / "gui_agents/__init__.py", "# stub package\n")
    write_file(STUB_ROOT / "gui_agents/s3/__init__.py", "# stub package\n")
    write_file(STUB_ROOT / "gui_agents/s3/agents/__init__.py", "# stub package\n")
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
        exec_code = "import pyautogui; import time; pyautogui.hotkey('command', 'space', interval=0.5); pyautogui.typewrite('Finder'); pyautogui.press('enter'); time.sleep(0.1)"
        if "approved by the user" in instruction.lower():
            action = "resume-noop"
            title = f"Stub Agent-S resume step {self.calls}"
        else:
            action = "noop"
            title = f"Stub Agent-S step {self.calls}"
        return [
            {
                "title": title,
                "summary": f"observed screenshot bytes={len(observation.get('screenshot', b''))} for: {instruction}",
                "action": action,
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

    sys.path.insert(0, str(STUB_ROOT))
    os.environ["PYTHONPYCACHEPREFIX"] = str(PYCACHE_DIR)


async def main() -> int:
    prepare_stub_modules()

    os.environ["KAYPAL_AGENT_S_RUNNER_MODE"] = "real"
    os.environ["KAYPAL_AGENT_S_REAL_PROVIDER"] = "agent_s_sdk"
    os.environ["KAYPAL_AGENT_S_SDK_API_KEY"] = "stub-api-key"
    os.environ["KAYPAL_AGENT_S_SDK_MODEL_PROVIDER"] = "openai"
    os.environ["KAYPAL_AGENT_S_SDK_MODEL"] = "gpt-4o"
    os.environ["KAYPAL_AGENT_S_SDK_MAX_STEPS"] = "1"
    os.environ["KAYPAL_AGENT_S_ARTIFACT_ROOT"] = str(WORK_DIR / "artifacts")

    from artifact_store import ArtifactStore
    from config import load_settings
    from models import CreateSessionRequest, RunSessionRequest
    from runner import RunnerContext, create_session_runner
    from session_store import SessionStore

    settings = load_settings()
    session_store = SessionStore()
    artifact_store = ArtifactStore(settings.artifact_root)
    import pyautogui

    def artifact_payload(artifact: object) -> dict:
        if hasattr(artifact, "model_dump"):
            return artifact.model_dump()
        return dict(artifact)

    def sync_artifact_count(session_id: str) -> None:
        session_store.set_artifact_count(
            session_id,
            len(artifact_store.list_artifacts(session_id)),
        )

    def record_event(
        session_id: str,
        *,
        event_type: str,
        status_value: str,
        run_id=None,
        message=None,
        step_index=None,
        artifact_id=None,
        payload=None,
    ):
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
        artifact_store.append_event(event.session_id, event)
        sync_artifact_count(event.session_id)
        return event

    def write_session_summary(session_id: str) -> None:
        artifact_store.write_session_summary(session_store.get_session(session_id))
        sync_artifact_count(session_id)

    async def sleep_with_cancel(_session_id: str, _delay_ms: int) -> bool:
        return True

    async def finish_cancelled(session_id: str, run_id: str, message: str) -> None:
        record_event(
            session_id,
            event_type="run_cancelled",
            status_value="cancelled",
            run_id=run_id,
            message=message,
            payload={"result": "cancelled"},
        )
        write_session_summary(session_id)

    runner = create_session_runner(
        RunnerContext(
            settings=settings,
            session_store=session_store,
            artifact_store=artifact_store,
            record_event=record_event,
            sync_artifact_count=sync_artifact_count,
            write_session_summary=write_session_summary,
            sleep_with_cancel=sleep_with_cancel,
            finish_cancelled=finish_cancelled,
            artifact_payload=artifact_payload,
        )
    )

    ensure(settings.real_provider == "agent_s_sdk", "settings use agent_s_sdk provider")
    pyautogui.OPS.clear()

    async def run_case(
        session_name: str,
        *,
        permission_mode: str,
        requires_approval: bool,
        approve_after: bool = False,
        expected_ops: int = 0,
        allowed_targets=None,
        allowed_text_inputs=None,
    ):
        session = session_store.create_session(
            CreateSessionRequest(session_name=session_name, task_type="desktop.gui.visual.real")
        )
        artifact_store.create_session_layout(session.session_id)
        write_session_summary(session.session_id)
        run_id = f"run_{session_name}"
        session_store.begin_run(
            session.session_id,
            run_id,
            task_type="desktop.gui.visual.real",
            metadata={},
        )
        pyautogui.OPS.clear()

        await runner.run(
            session.session_id,
            run_id,
            RunSessionRequest(
                instruction="Inspect desktop and propose a safe next action",
                risk_level="medium",
                requires_approval=requires_approval,
                metadata={
                    "local_controller_permission_mode": permission_mode,
                    "allowed_desktop_action_targets": allowed_targets or [],
                    "allowed_desktop_text_inputs": allowed_text_inputs or [],
                },
            ),
        )

        if approve_after:
            await runner.resolve_approval(
                session.session_id,
                "approved",
                "Approved from inline smoke",
            )

        current_session = session_store.get_session(session.session_id)
        current_events = session_store.list_events(session.session_id)
        current_artifacts = artifact_store.list_artifacts(session.session_id)
        current_artifact_names = {artifact.filename for artifact in current_artifacts}
        event_types = {event.event_type for event in current_events}

        ensure(current_session.status == "completed", f"{session_name} completed")
        ensure(len(pyautogui.OPS) == expected_ops, f"{session_name} executed {expected_ops} action groups")
        ensure("agent-s-sdk-policy-001.json" in current_artifact_names, f"{session_name} wrote policy artifact")
        ensure("external-agent-response.json" in current_artifact_names, f"{session_name} wrote response artifact")

        if expected_ops > 0:
            ensure(
                any(name.startswith("agent-s-sdk-action-execution-") for name in current_artifact_names),
                f"{session_name} wrote action execution artifacts",
            )

        policy_artifact = next(
            artifact for artifact in current_artifacts if artifact.filename == "agent-s-sdk-policy-001.json"
        )
        payload = json.loads(Path(policy_artifact.path).read_text(encoding="utf-8"))
        ensure(
            payload.get("permission_mode") == permission_mode,
            f"{session_name} policy artifact records permission mode",
        )

        if approve_after:
            ensure("approval_required" in event_types, f"{session_name} emitted approval_required")
            ensure(
                "agent-s-sdk-step-002.json" in current_artifact_names,
                f"{session_name} wrote resumed step artifact",
            )

    await run_case(
        "sdk-inline-restricted",
        permission_mode="restricted",
        requires_approval=False,
        expected_ops=0,
    )
    await run_case(
        "sdk-inline-custom",
        permission_mode="custom",
        requires_approval=False,
        approve_after=True,
        expected_ops=0,
    )
    await run_case(
        "sdk-inline-full",
        permission_mode="full",
        requires_approval=False,
        expected_ops=0,
    )
    await run_case(
        "sdk-inline-full-whitelist",
        permission_mode="full",
        requires_approval=False,
        expected_ops=3,
        allowed_targets=["Finder"],
        allowed_text_inputs=["Finder"],
    )
    await run_case(
        "sdk-inline-full-no-text-whitelist",
        permission_mode="full",
        requires_approval=False,
        expected_ops=0,
        allowed_targets=["Finder"],
        allowed_text_inputs=[],
    )

    approval_session = session_store.create_session(
        CreateSessionRequest(session_name="sdk-inline-approval", task_type="desktop.gui.visual.real")
    )
    artifact_store.create_session_layout(approval_session.session_id)
    write_session_summary(approval_session.session_id)

    approval_run_id = "run_inline_sdk_approval"
    session_store.begin_run(
        approval_session.session_id,
        approval_run_id,
        task_type="desktop.gui.visual.real",
        metadata={},
    )

    await runner.run(
        approval_session.session_id,
        approval_run_id,
        RunSessionRequest(
            instruction="Inspect desktop and pause after the first safe action",
            risk_level="high",
            requires_approval=True,
            metadata={"local_controller_permission_mode": "restricted"},
        ),
    )

    waiting_session = session_store.get_session(approval_session.session_id)
    ensure(waiting_session.status == "waiting_approval", "approval smoke entered waiting_approval")

    await runner.resolve_approval(
        approval_session.session_id,
        "approved",
        "Approved from inline smoke",
    )

    resumed_session = session_store.get_session(approval_session.session_id)
    resumed_events = session_store.list_events(approval_session.session_id)
    resumed_artifacts = artifact_store.list_artifacts(approval_session.session_id)
    resumed_event_types = {event.event_type for event in resumed_events}
    resumed_artifact_names = {artifact.filename for artifact in resumed_artifacts}

    ensure(resumed_session.status == "completed", "approval smoke completed after resume")
    ensure("approval_required" in resumed_event_types, "approval smoke emitted approval_required")
    ensure("run_completed" in resumed_event_types, "approval smoke emitted run_completed after resume")
    ensure(
        "agent-s-sdk-step-002.json" in resumed_artifact_names,
        "approval smoke wrote resumed step artifact",
    )
    ensure(
        "agent-s-sdk-post-approval.txt" in resumed_artifact_names,
        "approval smoke wrote post-approval note",
    )

    print("[PASS] inline Agent-S SDK smoke completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
