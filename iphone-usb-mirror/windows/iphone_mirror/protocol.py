from __future__ import annotations

import json
import socket
import struct
from typing import Any


def recv_exact(sock: socket.socket, size: int) -> bytes:
    chunks = bytearray()
    while len(chunks) < size:
        chunk = sock.recv(size - len(chunks))
        if not chunk:
            raise ConnectionError("Соединение закрыто")
        chunks.extend(chunk)
    return bytes(chunks)


def send_json(sock: socket.socket, message: dict[str, Any]) -> None:
    payload = json.dumps(message, separators=(",", ":")).encode("utf-8")
    sock.sendall(struct.pack(">I", len(payload)) + payload)


def recv_json(sock: socket.socket) -> dict[str, Any]:
    size = struct.unpack(">I", recv_exact(sock, 4))[0]
    if size > 1_048_576:
        raise ValueError("Слишком большой ответ управления")
    return json.loads(recv_exact(sock, size))

