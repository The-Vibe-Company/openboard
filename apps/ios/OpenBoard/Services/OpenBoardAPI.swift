import Foundation

enum OpenBoardAPIError: LocalizedError, Sendable {
    case invalidURL
    case unauthorized(String)
    case rateLimited
    case server(code: String, message: String, hint: String?)
    case httpStatus(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid server URL."
        case .unauthorized(let msg):
            return msg.isEmpty ? "Sign-in expired or unauthorized." : msg
        case .rateLimited:
            return "Rate limited — retrying shortly."
        case .server(_, let message, let hint):
            return hint.map { "\(message) \($0)" } ?? message
        case .httpStatus(let code, let text):
            return "Request failed (HTTP \(code)): \(text)"
        }
    }
}

struct OpenBoardAPI: Sendable {
    let origin: String
    let org: String
    let board: String
    let token: String?

    private static let decoder = JSONDecoder()

    init(origin: String, org: String = "tvc", board: String = "main", token: String? = nil) {
        self.origin = origin.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        self.org = org
        self.board = board
        self.token = token
    }

    init(session: SavedSession) {
        self.init(origin: session.origin, org: session.org, board: session.board, token: session.token)
    }

    // MARK: - Device Sign-In

    func startDeviceSignIn(clientName: String = "OpenBoard iOS") async throws -> DeviceStartResponse {
        try await request(
            method: "POST",
            path: "/api/x/auth/device",
            body: ["clientName": clientName],
            authenticated: false
        )
    }

    func pollDeviceSignIn(deviceCode: String) async throws -> DevicePollResponse {
        try await request(
            method: "POST",
            path: "/api/x/auth/device/token",
            body: ["deviceCode": deviceCode],
            authenticated: false
        )
    }

    // MARK: - Board Reads

    func getMe() async throws -> MeResponse {
        try await request(method: "GET", path: boardPath("/me"))
    }

    func listChannels() async throws -> ChannelsResponse {
        try await request(method: "GET", path: boardPath("/channels"), query: ["limit": "200"])
    }

    func createChannel(path: String) async throws -> CreateChannelResponse {
        try await request(method: "POST", path: boardPath("/channels"), body: ["path": path])
    }

    func listThreads(channel: String, text: String? = nil, before: String? = nil, limit: Int = 50) async throws -> ThreadsResponse {
        var query: [String: String] = ["channel": channel, "limit": "\(limit)"]
        if let text, !text.isEmpty { query["text"] = text }
        if let before, !before.isEmpty { query["before"] = before }
        return try await request(method: "GET", path: boardPath("/threads"), query: query)
    }

    func readThread(id: String, limit: Int = 200) async throws -> ThreadDetail {
        try await request(method: "GET", path: boardPath("/messages/\(id)"), query: ["limit": "\(limit)"])
    }

    func listTasks(channel: String? = nil, state: String = "all", after: String? = nil, limit: Int = 100) async throws -> TasksResponse {
        var query: [String: String] = ["state": state, "limit": "\(Self.taskPageLimit(limit))"]
        if let channel, !channel.isEmpty { query["channel"] = channel }
        if let after, !after.isEmpty { query["after"] = after }
        return try await request(method: "GET", path: boardPath("/tasks"), query: query)
    }

    static func taskPageLimit(_ requested: Int) -> Int {
        min(500, max(1, requested))
    }

    func listActors() async throws -> ActorsResponse {
        try await request(method: "GET", path: boardPath("/actors"))
    }

    func readEvents(channel: String? = nil, last: Int = 80, all: Bool = true) async throws -> EventsResponse {
        var query: [String: String] = ["last": "\(last)"]
        if all { query["all"] = "true" }
        if let channel, !channel.isEmpty { query["channel"] = channel }
        return try await request(method: "GET", path: boardPath("/events"), query: query)
    }

    // MARK: - Messages

    func postMessage(channel: String? = nil, re: String? = nil, text: String, labels: [String: String]? = nil, idempotencyKey: String? = nil) async throws -> PostMessageResponse {
        var body: [String: Any] = ["text": text]
        if let channel { body["channel"] = channel }
        if let re { body["re"] = re }
        if let labels, !labels.isEmpty { body["labels"] = labels }
        if let idempotencyKey { body["id"] = idempotencyKey }
        return try await requestRaw(method: "POST", path: boardPath("/messages"), jsonBody: body)
    }

    func editMessage(id: String, text: String) async throws {
        let _: EmptyOK = try await requestRaw(method: "POST", path: boardPath("/messages/\(id)/edit"), jsonBody: ["text": text])
    }

    func deleteMessage(id: String) async throws {
        let _: EmptyOK = try await requestRaw(method: "POST", path: boardPath("/messages/\(id)/delete"), jsonBody: [:])
    }

    func reactToMessage(id: String, emoji: String, remove: Bool) async throws {
        var body: [String: Any] = ["emoji": emoji]
        if remove { body["remove"] = true }
        let _: EmptyOK = try await requestRaw(method: "POST", path: boardPath("/messages/\(id)/reactions"), jsonBody: body)
    }

    // MARK: - Tasks

    func createTask(channel: String, text: String, labels: [String: String]? = nil, needs: [String]? = nil, idempotencyKey: String? = nil) async throws -> TaskMutationResponse {
        var body: [String: Any] = ["channel": channel, "text": text]
        if let labels, !labels.isEmpty { body["labels"] = labels }
        if let needs, !needs.isEmpty { body["needs"] = needs }
        if let idempotencyKey { body["id"] = idempotencyKey }
        return try await requestRaw(method: "POST", path: boardPath("/tasks"), jsonBody: body)
    }

    func claimTask(id: String, lease: Int = 900) async throws -> TaskMutationResponse {
        try await requestRaw(method: "POST", path: boardPath("/tasks/\(id)/claim"), jsonBody: ["lease": lease])
    }

    func completeTask(id: String, epoch: Int, token: String, result: String?) async throws -> TaskMutationResponse {
        var body: [String: Any] = ["epoch": epoch, "token": token]
        if let result, !result.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            body["result"] = result.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return try await requestRaw(method: "POST", path: boardPath("/tasks/\(id)/complete"), jsonBody: body)
    }

    func failTask(id: String, epoch: Int, token: String, reason: String) async throws -> TaskMutationResponse {
        try await requestRaw(method: "POST", path: boardPath("/tasks/\(id)/fail"), jsonBody: [
            "epoch": epoch,
            "token": token,
            "reason": reason,
        ])
    }

    func releaseTask(id: String, epoch: Int, token: String) async throws -> TaskMutationResponse {
        try await requestRaw(method: "POST", path: boardPath("/tasks/\(id)/release"), jsonBody: [
            "epoch": epoch,
            "token": token,
        ])
    }

    func blockTask(id: String, reason: String, claim: LocalTaskClaim?) async throws -> TaskMutationResponse {
        var body: [String: Any] = ["reason": reason]
        if let claim {
            body["epoch"] = claim.epoch
            body["token"] = claim.token
        }
        return try await requestRaw(method: "POST", path: boardPath("/tasks/\(id)/block"), jsonBody: body)
    }

    func unblockTask(id: String) async throws -> TaskMutationResponse {
        try await requestRaw(method: "POST", path: boardPath("/tasks/\(id)/unblock"), jsonBody: [:])
    }

    func cancelTask(id: String, reason: String) async throws -> TaskMutationResponse {
        try await requestRaw(method: "POST", path: boardPath("/tasks/\(id)/cancel"), jsonBody: ["reason": reason])
    }

    func eventsStreamRequest(lastEventID: String?) throws -> URLRequest {
        var components = URLComponents(string: "\(origin)\(boardPath("/events"))")
        components?.queryItems = [URLQueryItem(name: "all", value: "true")]
        guard let url = components?.url else { throw OpenBoardAPIError.invalidURL }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.timeoutInterval = 3600
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        req.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        if let token, !token.isEmpty {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let lastEventID, !lastEventID.isEmpty {
            req.setValue(lastEventID, forHTTPHeaderField: "Last-Event-ID")
        }
        return req
    }

    // MARK: - Internals

    private func boardPath(_ suffix: String) -> String {
        let encodedOrg = org.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? org
        let encodedBoard = board.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? board
        return "/api/\(encodedOrg)/\(encodedBoard)\(suffix)"
    }

    private func request<T: Decodable>(
        method: String,
        path: String,
        query: [String: String] = [:],
        body: [String: String]? = nil,
        authenticated: Bool = true
    ) async throws -> T {
        try await requestRaw(method: method, path: path, query: query, jsonBody: body, authenticated: authenticated)
    }

    private func requestRaw<T: Decodable>(
        method: String,
        path: String,
        query: [String: String] = [:],
        jsonBody: [String: Any]? = nil,
        authenticated: Bool = true
    ) async throws -> T {
        guard var components = URLComponents(string: "\(origin)\(path)") else {
            throw OpenBoardAPIError.invalidURL
        }
        if !query.isEmpty {
            components.queryItems = query.sorted(by: { $0.key < $1.key }).map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components.url else { throw OpenBoardAPIError.invalidURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 25
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if authenticated, let token, !token.isEmpty {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let jsonBody {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: jsonBody)
        }

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw OpenBoardAPIError.httpStatus(0, "No HTTP response")
        }
        if (200..<300).contains(http.statusCode) {
            return try Self.decoder.decode(T.self, from: data)
        }
        if let envelope = try? Self.decoder.decode(APIErrorEnvelope.self, from: data) {
            if http.statusCode == 401 || envelope.error.code == "unauthorized" {
                throw OpenBoardAPIError.unauthorized(envelope.error.message)
            }
            if http.statusCode == 429 || envelope.error.code == "rate_limited" {
                throw OpenBoardAPIError.rateLimited
            }
            throw OpenBoardAPIError.server(code: envelope.error.code, message: envelope.error.message, hint: envelope.error.hint)
        }
        let bodyText = String(data: data, encoding: .utf8) ?? ""
        throw OpenBoardAPIError.httpStatus(http.statusCode, bodyText)
    }
}

private struct EmptyOK: Decodable {
    let ok: Bool?
}
