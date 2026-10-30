from __future__ import annotations

import subprocess
from dataclasses import dataclass

from .tools import find_tool


@dataclass(frozen=True, slots=True)
class Device:
    udid: str
    name: str
    trusted: bool
    trust_message: str = ""


class DeviceProbe:
    def __init__(self) -> None:
        self.idevice_id = find_tool("idevice_id")
        self.idevicepair = find_tool("idevicepair")
        self.ideviceinfo = find_tool("ideviceinfo")

    @property
    def available(self) -> bool:
        return bool(self.idevice_id and self.idevicepair)

    def scan(self) -> list[Device]:
        if not self.available:
            return []
        result = self._run([self.idevice_id, "-l"])
        if result.returncode != 0:
            return []
        devices: list[Device] = []
        for udid in (line.strip() for line in result.stdout.splitlines()):
            if not udid:
                continue
            pair = self._run([self.idevicepair, "-u", udid, "validate"])
            combined = f"{pair.stdout}\n{pair.stderr}".strip()
            trusted = pair.returncode == 0 and "SUCCESS" in combined.upper()
            name = self._device_name(udid)
            devices.append(Device(udid, name, trusted, combined))
        return devices

    def pair(self, udid: str) -> tuple[bool, str]:
        if not self.idevicepair:
            return False, "idevicepair не найден"
        result = self._run([self.idevicepair, "-u", udid, "pair"], timeout=30)
        message = f"{result.stdout}\n{result.stderr}".strip()
        return result.returncode == 0 and "SUCCESS" in message.upper(), message

    def _device_name(self, udid: str) -> str:
        if not self.ideviceinfo:
            return "iPhone"
        result = self._run([self.ideviceinfo, "-u", udid, "-k", "DeviceName"])
        return result.stdout.strip() if result.returncode == 0 and result.stdout.strip() else "iPhone"

    @staticmethod
    def _run(args: list[str | None], timeout: int = 5) -> subprocess.CompletedProcess[str]:
        try:
            return subprocess.run(
                [arg for arg in args if arg],
                capture_output=True,
                text=True,
                errors="replace",
                timeout=timeout,
                creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            return subprocess.CompletedProcess([], 1, "", str(exc))

