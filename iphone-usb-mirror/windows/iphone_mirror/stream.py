from __future__ import annotations

import queue
import socket
import struct
import threading
import time
from dataclasses import dataclass

import av
from PySide6.QtCore import QThread, Signal
from PySide6.QtGui import QImage
from PySide6.QtMultimedia import QAudioFormat, QAudioSink, QMediaDevices

from .protocol import recv_exact, recv_json, send_json


@dataclass(frozen=True, slots=True)
class StreamConfig:
    resolution: int = 1080
    fps: int = 60
    bitrate: int = 10_000_000
    audio: bool = True
    hardware_decode: bool = True


class LatestFrame:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._image: QImage | None = None
        self._serial = 0

    def put(self, image: QImage) -> None:
        with self._lock:
            self._image = image
            self._serial += 1

    def get_after(self, serial: int) -> tuple[int, QImage | None]:
        with self._lock:
            if self._serial == serial:
                return serial, None
            return self._serial, self._image


class VideoWorker(QThread):
    status = Signal(str)
    stats = Signal(float, str)
    disconnected = Signal(str)

    def __init__(self, frames: LatestFrame, hardware: bool = True) -> None:
        super().__init__()
        self.frames = frames
        self.hardware = hardware
        self._stop = threading.Event()
        self._socket: socket.socket | None = None

    def stop(self) -> None:
        self._stop.set()
        if self._socket:
            try:
                self._socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def run(self) -> None:
        candidates = ["h264_cuvid", "h264_qsv", "h264"] if self.hardware else ["h264"]
        errors: list[str] = []
        for decoder in candidates:
            if self._stop.is_set():
                return
            try:
                self._decode(decoder)
                return
            except Exception as exc:  # Decoder/device availability is runtime-specific.
                errors.append(f"{decoder}: {exc}")
                if decoder != "h264":
                    self.status.emit(f"{decoder} недоступен, пробую другой декодер…")
        if not self._stop.is_set():
            message = errors[-1] if errors else "видеопоток остановлен"
            self.disconnected.emit(message)

    def _decode(self, decoder_name: str) -> None:
        codec = av.CodecContext.create(decoder_name, "r")
        codec.options = {"flags": "low_delay", "threads": "1"}
        sock = socket.create_connection(("127.0.0.1", 12005), timeout=3)
        self._socket = sock
        sock.settimeout(2)
        self.status.emit(f"Видео подключено · {decoder_name}")
        decoded = 0
        window_start = time.perf_counter()
        while not self._stop.is_set():
            try:
                data = sock.recv(256 * 1024)
            except socket.timeout:
                continue
            if not data:
                raise ConnectionError("iPhone закрыл видеопоток")
            for packet in codec.parse(data):
                for frame in codec.decode(packet):
                    array = frame.to_ndarray(format="bgra")
                    height, width = array.shape[:2]
                    image = QImage(
                        array.data, width, height, array.strides[0], QImage.Format.Format_BGRA8888
                    ).copy()
                    self.frames.put(image)
                    decoded += 1
            now = time.perf_counter()
            if now - window_start >= 1:
                self.stats.emit(decoded / (now - window_start), decoder_name)
                decoded = 0
                window_start = now


class ControlWorker(QThread):
    ready = Signal()
    latency = Signal(float)
    status = Signal(str)

    def __init__(self, config: StreamConfig) -> None:
        super().__init__()
        self._config = config
        self._commands: queue.SimpleQueue[dict] = queue.SimpleQueue()
        self._stop = threading.Event()
        self._socket: socket.socket | None = None
        self._next_id = 1

    def stop(self) -> None:
        self._stop.set()
        if self._socket:
            try:
                self._socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def set_config(self, config: StreamConfig) -> None:
        self._config = config
        self._commands.put(self._config_message(config))

    def run(self) -> None:
        try:
            sock = socket.create_connection(("127.0.0.1", 12007), timeout=5)
            self._socket = sock
            sock.settimeout(2)
            self._exchange(sock, self._config_message(self._config))
            self.ready.emit()
            last_ping = 0.0
            while not self._stop.is_set():
                try:
                    command = self._commands.get_nowait()
                except queue.Empty:
                    command = None
                if command:
                    self._exchange(sock, command)
                now = time.perf_counter()
                if now - last_ping >= 1:
                    start = time.perf_counter()
                    self._exchange(sock, {"method": "ping"})
                    rtt_ms = (time.perf_counter() - start) * 1000
                    # Estimate: half control RTT plus roughly 1.5 frame periods.
                    self.latency.emit(rtt_ms / 2 + 1500 / max(1, self._config.fps))
                    last_ping = now
                self.msleep(20)
        except Exception as exc:
            if not self._stop.is_set():
                self.status.emit(f"Канал управления: {exc}")

    def _exchange(self, sock: socket.socket, payload: dict) -> dict:
        message = {"id": self._next_id, **payload}
        self._next_id += 1
        send_json(sock, message)
        return recv_json(sock)

    @staticmethod
    def _config_message(config: StreamConfig) -> dict:
        return {
            "method": "setConfig",
            "params": {
                "resolution": config.resolution,
                "fps": config.fps,
                "bitrate": config.bitrate,
            },
        }


class AudioWorker(QThread):
    status = Signal(str)

    def __init__(self) -> None:
        super().__init__()
        self._stop = threading.Event()
        self._socket: socket.socket | None = None

    def stop(self) -> None:
        self._stop.set()
        if self._socket:
            try:
                self._socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def run(self) -> None:
        sink: QAudioSink | None = None
        device = None
        current = None
        try:
            sock = socket.create_connection(("127.0.0.1", 12006), timeout=5)
            self._socket = sock
            sock.settimeout(3)
            while not self._stop.is_set():
                size = struct.unpack(">I", recv_exact(sock, 4))[0]
                if size < 8 or size > 2_000_000:
                    raise ValueError("Некорректный аудиопакет")
                payload = recv_exact(sock, size)
                rate, channels, sample_format = struct.unpack(">IHH", payload[:8])
                key = (rate, channels, sample_format)
                if key != current:
                    if sample_format != 1:
                        raise ValueError("Неподдерживаемый формат аудио")
                    fmt = QAudioFormat()
                    fmt.setSampleRate(rate)
                    fmt.setChannelCount(channels)
                    fmt.setSampleFormat(QAudioFormat.SampleFormat.Float)
                    sink = QAudioSink(QMediaDevices.defaultAudioOutput(), fmt)
                    sink.setBufferSize(max(4096, fmt.bytesForDuration(80_000)))
                    device = sink.start()
                    current = key
                    self.status.emit(f"Звук · {rate} Гц · {channels} кан.")
                if device:
                    device.write(payload[8:])
        except Exception as exc:
            if not self._stop.is_set():
                self.status.emit(f"Звук недоступен: {exc}")
        finally:
            if sink:
                sink.stop()
