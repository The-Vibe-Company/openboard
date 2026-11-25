import Foundation

enum LiveConnectionState: Equatable, Sendable {
    case disconnected
    case connecting
    case connected
    case reconnecting
}

struct SSEStreamDecoder: Sendable {
    private var buffer = Data()
    private var eventType = ""
    private var eventID = ""
    private var dataLines: [String] = []

    mutating func consume(byte: UInt8) -> (id: String?, event: BoardEvent)? {
        if byte == 0x0A { // '\n'
            let lineData: Data
            if buffer.last == 0x0D { // '\r'
                lineData = buffer.dropLast()
            } else {
                lineData = buffer
            }
            let line = String(decoding: lineData, as: UTF8.self)
            buffer.removeAll(keepingCapacity: true)
            return consume(line: line)
        } else {
            buffer.append(byte)
            return nil
        }
    }

    mutating func consume(line: String) -> (id: String?, event: BoardEvent)? {
        if line.isEmpty {
            defer {
                eventType = ""
                eventID = ""
                dataLines.removeAll(keepingCapacity: true)
            }
            guard !dataLines.isEmpty else { return nil }
            let id = eventID.isEmpty ? nil : eventID
            guard eventType.isEmpty || eventType == "board" else { return nil }
            let payload = dataLines.joined(separator: "\n")
            guard let event = SSEFrameParser.parseBoardEvent(from: payload) else { return nil }
            return (id ?? event.cursor, event)
        }
        if line.hasPrefix(":") { return nil }
        if line.hasPrefix("event:") {
            eventType = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
        } else if line.hasPrefix("id:") {
            eventID = line.dropFirst(3).trimmingCharacters(in: .whitespaces)
        } else if line.hasPrefix("data:") {
            let value = line.dropFirst(5)
            dataLines.append(value.hasPrefix(" ") ? String(value.dropFirst()) : String(value))
        }
        return nil
    }
}

actor BoardEventStream {
    private var streamTask: Task<Void, Never>?
    private var lastEventID: String?

    func start(
        api: OpenBoardAPI,
        onState: @escaping @Sendable (LiveConnectionState) -> Void,
        onEvent: @escaping @Sendable (BoardEvent) -> Void
    ) {
        stop()
        streamTask = Task {
            var retryDelay: UInt64 = 1_000_000_000
            var everConnected = false
            while !Task.isCancelled {
                onState(everConnected ? .reconnecting : .connecting)
                do {
                    let request = try api.eventsStreamRequest(lastEventID: lastEventID)
                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                        throw URLError(.badServerResponse)
                    }
                    everConnected = true
                    retryDelay = 1_000_000_000
                    onState(.connected)

                    var decoder = SSEStreamDecoder()
                    for try await byte in bytes {
                        if Task.isCancelled { break }
                        if let frame = decoder.consume(byte: byte) {
                            if let id = frame.id { lastEventID = id }
                            onEvent(frame.event)
                        }
                    }
                } catch {
                    if Task.isCancelled { break }
                }
                if Task.isCancelled { break }
                onState(.reconnecting)
                try? await Task.sleep(nanoseconds: retryDelay)
                retryDelay = min(retryDelay * 2, 30_000_000_000)
            }
            onState(.disconnected)
        }
    }

    func stop() {
        streamTask?.cancel()
        streamTask = nil
    }
}

enum SSEFrameParser {
    static func parseBoardEvent(from json: String) -> BoardEvent? {
        guard let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(BoardEvent.self, from: data)
    }
}
