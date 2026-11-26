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
    private var eventID: String?
    private var dataLines: [String] = []

    mutating func consume(byte: UInt8) -> (id: String?, event: BoardEvent?)? {
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

    mutating func consume(line: String) -> (id: String?, event: BoardEvent?)? {
        if line.isEmpty {
            defer {
                eventType = ""
                eventID = nil
                dataLines.removeAll(keepingCapacity: true)
            }
            let event = !dataLines.isEmpty && (eventType.isEmpty || eventType == "board")
                ? SSEFrameParser.parseBoardEvent(from: dataLines.joined(separator: "\n"))
                : nil
            guard let id = eventID ?? event?.cursor else { return nil }
            return (id, event)
        }
        if line.hasPrefix(":") { return nil }
        if line.hasPrefix("event:") {
            eventType = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
        } else if line.hasPrefix("id:") {
            let id = line.dropFirst(3).trimmingCharacters(in: .whitespaces)
            if !id.contains("\0") { eventID = id }
        } else if line.hasPrefix("data:") {
            let value = line.dropFirst(5)
            dataLines.append(value.hasPrefix(" ") ? String(value.dropFirst()) : String(value))
        }
        return nil
    }
}

@MainActor
final class BoardEventStream {
    private var streamTask: Task<Void, Never>?

    func start(
        api: OpenBoardAPI,
        initialCursor: String?,
        onState: @escaping @MainActor @Sendable (LiveConnectionState) -> Void,
        onEvent: @escaping @MainActor @Sendable (BoardEvent) -> Void
    ) {
        stop()
        streamTask = Task.detached {
            var lastEventID = initialCursor
            var retryDelay: UInt64 = 1_000_000_000
            var everConnected = false
            while !Task.isCancelled {
                await onState(everConnected ? .reconnecting : .connecting)
                do {
                    let request = try api.eventsStreamRequest(lastEventID: lastEventID)
                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    try Task.checkCancellation()
                    guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
                    if Self.isTerminal(status: http.statusCode) { break }
                    guard (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }
                    everConnected = true
                    retryDelay = 1_000_000_000
                    await onState(.connected)

                    var decoder = SSEStreamDecoder()
                    for try await byte in bytes {
                        if Task.isCancelled { break }
                        if let frame = decoder.consume(byte: byte) {
                            if let id = frame.id { lastEventID = id }
                            if let event = frame.event { await onEvent(event) }
                        }
                    }
                } catch {
                    if Task.isCancelled { break }
                }
                if Task.isCancelled { break }
                await onState(.reconnecting)
                try? await Task.sleep(nanoseconds: retryDelay)
                retryDelay = min(retryDelay * 2, 30_000_000_000)
            }
            if !Task.isCancelled { await onState(.disconnected) }
        }
    }

    nonisolated static func isTerminal(status: Int) -> Bool {
        status == 401 || status == 403
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
