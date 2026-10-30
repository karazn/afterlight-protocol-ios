import socket
import threading

from iphone_mirror.protocol import recv_json, send_json


def test_length_prefixed_json_roundtrip():
    left, right = socket.socketpair()
    expected = {"id": 7, "method": "ping", "params": {"fps": 60}}
    thread = threading.Thread(target=send_json, args=(left, expected))
    thread.start()
    assert recv_json(right) == expected
    thread.join()
    left.close()
    right.close()
