#!/usr/bin/env python3
"""Shared protocol implementation; keep byte-identical with the Xiaohongshu copy."""

from pathlib import Path
import runpy

SOURCE = Path(__file__).resolve().parents[3].parent / "xiaohongshu-operator" / "xiaohongshu-operator-skills" / "codex-visual-production" / "scripts" / "visual_inbox.py"
if not SOURCE.is_file():
    raise SystemExit(f"shared visual inbox implementation missing: {SOURCE}")
runpy.run_path(str(SOURCE), run_name="__main__")
