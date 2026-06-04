#!/usr/bin/env python3
"""Real on-machine self-check for Agent-S sidecar prerequisites on macOS."""

from __future__ import annotations

import importlib
import sys
from typing import Callable


def record(ok: bool, message: str) -> bool:
    prefix = "PASS" if ok else "FAIL"
    print(f"[{prefix}] {message}")
    return ok


def optional_record(ok: bool, message: str) -> bool:
    prefix = "PASS" if ok else "WARN"
    print(f"[{prefix}] {message}")
    return ok


def check_import(module_name: str) -> bool:
    try:
        importlib.import_module(module_name)
        return record(True, f"python import ok: {module_name}")
    except Exception as exc:
        return record(False, f"python import failed: {module_name} ({exc})")


def check_condition(name: str, fn: Callable[[], bool]) -> bool:
    try:
        return record(bool(fn()), name)
    except Exception as exc:
        return record(False, f"{name} ({exc})")


def check_optional(name: str, fn: Callable[[], bool]) -> bool:
    try:
        return optional_record(bool(fn()), name)
    except Exception as exc:
        return optional_record(False, f"{name} ({exc})")


def main() -> int:
    ok = True

    ok &= check_import("gui_agents")
    ok &= check_import("pyautogui")
    ok &= check_import("PIL")

    from Quartz import CGPreflightScreenCaptureAccess
    from ApplicationServices import AXIsProcessTrusted

    ok &= check_condition(
        "macOS Screen Recording permission granted",
        lambda: bool(CGPreflightScreenCaptureAccess()),
    )
    ok &= check_condition(
        "macOS Accessibility permission granted",
        lambda: bool(AXIsProcessTrusted()),
    )

    def screenshot_ok() -> bool:
        import pyautogui

        image = pyautogui.screenshot()
        return bool(getattr(image, "size", None))

    screenshot_ready = check_optional(
        "desktop screenshot capture works",
        screenshot_ok,
    )

    if ok and screenshot_ready:
        print("[INFO] This machine is ready for a real Agent-S GUI smoke.")
        return 0

    print("[INFO] This machine is not yet ready for a real Agent-S GUI smoke.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
