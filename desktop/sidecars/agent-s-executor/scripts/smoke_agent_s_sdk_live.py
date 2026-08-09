#!/usr/bin/env python3
"""Minimal real on-machine live smoke for the Agent-S SDK adapter."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def fail(message: str) -> int:
    print(f"[FAIL] {message}")
    return 1


def ok(message: str) -> None:
    print(f"[PASS] {message}")


def _load_dotenv_local() -> None:
    root = Path(__file__).resolve().parents[3]
    env_path = root / ".env.local"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def main() -> int:
    _load_dotenv_local()

    try:
        from Quartz import CGPreflightScreenCaptureAccess
        from ApplicationServices import AXIsProcessTrusted
        import pyautogui
        from gui_agents.s3.agents.agent_s import AgentS3
        from gui_agents.s3.agents.grounding import OSWorldACI
    except Exception as exc:
        return fail(f"required dependency import failed: {exc}")

    if not CGPreflightScreenCaptureAccess():
        return fail("macOS Screen Recording permission is not granted")
    ok("macOS Screen Recording permission granted")

    if not AXIsProcessTrusted():
        return fail("macOS Accessibility permission is not granted")
    ok("macOS Accessibility permission granted")

    api_key = (
        os.environ.get("KAYPAL_AGENT_S_SDK_API_KEY")
        or os.environ.get("DASHSCOPE_API_KEY")
        or os.environ.get("ARK_API_KEY")
        or os.environ.get("VOLCENGINE_API_KEY")
    )
    if not api_key:
        return fail("no usable API key found for live Agent-S smoke")

    provider = os.environ.get("KAYPAL_AGENT_S_SDK_MODEL_PROVIDER") or "openai"
    model = os.environ.get("KAYPAL_AGENT_S_SDK_MODEL") or "qwen-vl-max-latest"
    base_url = os.environ.get("KAYPAL_AGENT_S_SDK_BASE_URL") or os.environ.get(
        "DASHSCOPE_BASE_URL",
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
    )

    screenshot = pyautogui.screenshot()
    ok(f"desktop screenshot captured: {screenshot.size[0]}x{screenshot.size[1]}")

    engine_params = {
        "engine_type": provider,
        "model": model,
        "api_key": api_key,
        "base_url": base_url,
    }
    grounding_engine = {
        "engine_type": provider,
        "model": model,
        "api_key": api_key,
        "base_url": base_url,
        "grounding_width": screenshot.size[0],
        "grounding_height": screenshot.size[1],
    }

    try:
        grounding_agent = OSWorldACI(
            env=None,
            platform="darwin",
            engine_params_for_generation=engine_params,
            engine_params_for_grounding=grounding_engine,
            width=screenshot.size[0],
            height=screenshot.size[1],
        )
        agent = AgentS3(
            engine_params,
            grounding_agent,
            platform="darwin",
            max_trajectory_length=1,
            enable_reflection=False,
        )
        prediction = agent.predict(
            instruction="Observe the current desktop and return the next safe GUI action. Do not assume permission to click.",
            observation={"screenshot": _image_to_png_bytes(screenshot)},
        )
    except Exception as exc:
        return fail(f"live Agent-S SDK predict failed: {exc}")

    rendered = _render_prediction(prediction)
    print("[INFO] live prediction summary:")
    print(rendered[:2000])
    ok("live Agent-S SDK predict completed")
    return 0


def _image_to_png_bytes(image) -> bytes:
    from io import BytesIO

    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _render_prediction(prediction) -> str:
    try:
        return json.dumps(prediction, ensure_ascii=False, indent=2, default=str)
    except Exception:
        return str(prediction)


if __name__ == "__main__":
    sys.exit(main())
