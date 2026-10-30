from __future__ import annotations

import subprocess
import time

from .tools import find_tool


class USBTunnel:
    PORTS = ((12005, 12005), (12006, 12006), (12007, 12007))

    def __init__(self) -> None:
        self.process: subprocess.Popen[str] | None = None
        self.udid: str | None = None

    @property
    def alive(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def start(self, udid: str) -> tuple[bool, str]:
        self.stop()
        iproxy = find_tool("iproxy")
        if not iproxy:
            return False, "iproxy.exe не найден"
        mappings = [f"{local}:{remote}" for local, remote in self.PORTS]
        flags = subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
        try:
            self.process = subprocess.Popen(
                [iproxy, "-u", udid, *mappings],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                creationflags=flags,
            )
            self.udid = udid
            time.sleep(0.2)
            if self.process.poll() is not None:
                error = self.process.stderr.read() if self.process.stderr else "iproxy завершился"
                self.stop()
                return False, error.strip()
            return True, "USB-туннель запущен"
        except OSError as exc:
            self.stop()
            return False, str(exc)

    def stop(self) -> None:
        process, self.process = self.process, None
        self.udid = None
        if process is None:
            return
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
