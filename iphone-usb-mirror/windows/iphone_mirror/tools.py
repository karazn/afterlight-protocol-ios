from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path


def app_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def find_tool(name: str) -> str | None:
    executable = f"{name}.exe" if os.name == "nt" else name
    candidates = [
        app_root() / "tools" / "libimobiledevice" / executable,
        app_root() / "tools" / executable,
        Path.cwd() / "tools" / "libimobiledevice" / executable,
    ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return shutil.which(executable) or shutil.which(name)
