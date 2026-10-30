import Foundation
import Network

final class TCPServer {
    private let listener: NWListener
    private let queue: DispatchQueue
    private let lock = NSLock()
    private var connection: NWConnection?
    private var sending = false
    var onData: ((Data, NWConnection) -> Void)?

    init(port: UInt16, label: String) throws {
        guard let nwPort = NWEndpoint.Port(rawValue: port) else {
            throw NSError(domain: "USBMirror", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Invalid TCP port"])
        }
        listener = try NWListener(using: .tcp, on: nwPort)
        queue = DispatchQueue(label: label, qos: .userInteractive)
    }

    func start() {
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
        listener.start(queue: queue)
    }

    func stop() {
        lock.lock()
        let current = connection
        connection = nil
        sending = false
        lock.unlock()
        current?.cancel()
        listener.cancel()
    }

    var canSend: Bool {
        lock.lock(); defer { lock.unlock() }
        return connection != nil && !sending
    }

    @discardableResult
    func sendDroppingIfBusy(_ data: Data) -> Bool {
        lock.lock()
        guard let current = connection, !sending else {
            lock.unlock()
            return false
        }
        sending = true
        lock.unlock()
        current.send(content: data, completion: .contentProcessed { [weak self] error in
            guard let self else { return }
            self.lock.lock()
            self.sending = false
            if error != nil && self.connection === current { self.connection = nil }
            self.lock.unlock()
        })
        return true
    }

    func send(_ data: Data, to connection: NWConnection) {
        connection.send(content: data, completion: .contentProcessed { _ in })
    }

    private func accept(_ newConnection: NWConnection) {
        lock.lock()
        let old = connection
        connection = newConnection
        sending = false
        lock.unlock()
        old?.cancel()
        newConnection.stateUpdateHandler = { [weak self, weak newConnection] state in
            if case .failed = state { self?.remove(newConnection) }
            if case .cancelled = state { self?.remove(newConnection) }
        }
        newConnection.start(queue: queue)
        receive(on: newConnection)
    }

    private func receive(on connection: NWConnection) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) {
            [weak self, weak connection] data, _, complete, error in
            guard let self, let connection else { return }
            if let data, !data.isEmpty { self.onData?(data, connection) }
            if complete || error != nil { self.remove(connection); return }
            self.receive(on: connection)
        }
    }

    private func remove(_ candidate: NWConnection?) {
        lock.lock()
        if connection === candidate {
            connection = nil
            sending = false
        }
        lock.unlock()
    }
}

final class ControlServer {
    private let server: TCPServer
    private let lock = NSLock()
    private var buffers: [ObjectIdentifier: Data] = [:]
    var handler: (([String: Any]) -> [String: Any])?

    init(port: UInt16) throws {
        server = try TCPServer(port: port, label: "org.iphoneusbmirror.control")
        server.onData = { [weak self] data, connection in self?.consume(data, from: connection) }
    }

    func start() { server.start() }
    func stop() { server.stop() }

    private func consume(_ data: Data, from connection: NWConnection) {
        let key = ObjectIdentifier(connection)
        lock.lock()
        var buffer = buffers[key, default: Data()]
        buffer.append(data)
        while buffer.count >= 4 {
            let length = buffer.prefix(4).reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
            guard length <= 1_048_576 else { buffer.removeAll(); break }
            let total = 4 + Int(length)
            guard buffer.count >= total else { break }
            let payload = buffer.subdata(in: 4..<total)
            buffer.removeSubrange(0..<total)
            respond(to: payload, connection: connection)
        }
        buffers[key] = buffer
        lock.unlock()
    }

    private func respond(to payload: Data, connection: NWConnection) {
        guard let object = try? JSONSerialization.jsonObject(with: payload) as? [String: Any] else { return }
        var response = handler?(object) ?? ["ok": false]
        if let id = object["id"] { response["id"] = id }
        guard let encoded = try? JSONSerialization.data(withJSONObject: response) else { return }
        var length = UInt32(encoded.count).bigEndian
        var packet = Data(bytes: &length, count: 4)
        packet.append(encoded)
        server.send(packet, to: connection)
    }
}
