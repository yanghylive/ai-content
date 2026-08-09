#!/usr/bin/env python3
"""Minimal self-check for the agent-s-executor sidecar workspace."""

from __future__ import annotations

import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SIDECAR_URL = os.environ.get("SIDECAR_URL", "").rstrip("/")
ENDPOINTS = ("/healthz", "/readyz", "/health", "/ready")


def record(ok: bool, message: str) -> bool:
    prefix = "PASS" if ok else "FAIL"
    print(f"[{prefix}] {message}")
    return ok


def check_files() -> bool:
    required = (
        ROOT / "README.md",
        ROOT / "docs" / "verification.md",
        ROOT / "scripts" / "smoke-sidecar.sh",
        ROOT / "scripts" / "smoke-real-runner.sh",
        ROOT / "scripts" / "smoke-agent-s-sdk.sh",
        ROOT / "scripts" / "smoke-agent-s-sdk-live.sh",
        ROOT / "scripts" / "smoke-agent-s-sdk-sidecar-live.sh",
        ROOT / "scripts" / "mock_external_agent.py",
        ROOT / "scripts" / "selfcheck_sidecar.py",
        ROOT / "scripts" / "selfcheck_real_agent_s.py",
    )
    all_ok = True
    for path in required:
        all_ok &= record(path.is_file(), f"file exists: {path.relative_to(ROOT)}")
    return all_ok


def probe_sidecar(base_url: str) -> bool:
    for endpoint in ENDPOINTS:
        url = f"{base_url}{endpoint}"
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                code = getattr(response, "status", response.getcode())
                if 200 <= code < 300:
                    return record(True, f"live probe ok: {url} -> {code}")
        except urllib.error.URLError:
            continue
        except Exception:  # pragma: no cover - defensive bootstrap script
            continue
    return record(False, f"no healthy endpoint found under {base_url}")


def main() -> int:
    ok = check_files()

    smoke_script = ROOT / "scripts" / "smoke-sidecar.sh"
    ok &= record(os.access(smoke_script, os.X_OK), "smoke script is executable")

    if SIDECAR_URL:
        ok &= probe_sidecar(SIDECAR_URL)
    else:
        print("[INFO] SIDECAR_URL not set, skipping live HTTP probe")

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
