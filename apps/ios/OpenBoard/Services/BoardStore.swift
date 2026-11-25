import Foundation
import Observation

@Observable
@MainActor
final class BoardStore {
    var session: SavedSession?
    var me: MeResponse?
    var channels: [ChannelInfo] = []
    var boardTasks: [ThreadSummary] = []
    var boardTasksNextCursor: String?
    var actorsByID: [String: ActorInfo] = [:]
    var events: [BoardEvent] = []
    var liveState: LiveConnectionState = .disconnected
    var activityPaused = false
    var isBootstrapping = false
    var errorBanner: String?
    var appearance: AppearancePreference {
        didSet {
            UserDefaults.standard.set(appearance.rawValue, forKey: "ob.appearance")
        }
    }

    private(set) var threadsByChannel: [String: [ThreadSummary]] = [:]
    private(set) var localClaims: [String: LocalTaskClaim] = [:]
    private let eventStream = BoardEventStream()
    private var refreshTasks: [String: Task<Void, Never>] = [:]
    private var boardRefreshTask: Task<Void, Never>?

    var api: OpenBoardAPI? {
        session.map { OpenBoardAPI(session: $0) }
    }

    init() {
        let savedAppearance = UserDefaults.standard.string(forKey: "ob.appearance")
        self.appearance = savedAppearance.flatMap(AppearancePreference.init(rawValue:)) ?? .system
        self.localClaims = KeychainStore.loadClaims()
        if let saved = KeychainStore.loadSession() {
            self.session = saved
            Task { await bootstrap() }
        }
    }

    func completeSignIn(_ newSession: SavedSession) async {
        KeychainStore.saveSession(newSession)
        session = newSession
        errorBanner = nil
        await bootstrap()
    }

    func switchBoard(slug: String) async {
        guard var current = session, current.board != slug else { return }
        current.board = slug
        KeychainStore.saveSession(current)
        session = current
        threadsByChannel = [:]
        boardTasks = []
        events = []
        await bootstrap()
    }

    func signOut() {
        Task { await eventStream.stop() }
        KeychainStore.clearSession()
        session = nil
        me = nil
        channels = []
        boardTasks = []
        boardTasksNextCursor = nil
        actorsByID = [:]
        events = []
        threadsByChannel = [:]
        localClaims = [:]
        liveState = .disconnected
        errorBanner = nil
    }

    func bootstrap() async {
        guard let api else { return }
        isBootstrapping = true
        errorBanner = nil
        defer { isBootstrapping = false }
        do {
            async let meReq = api.getMe()
            async let channelsReq = api.listChannels()
            async let tasksReq = api.listTasks(state: "all", limit: 100)
            async let actorsReq = api.listActors()
            async let eventsReq = api.readEvents(last: 80, all: true)

            me = try await meReq
            channels = try await channelsReq.channels.sorted { $0.path < $1.path }
            let taskPage = try await tasksReq
            boardTasks = taskPage.tasks
            boardTasksNextCursor = taskPage.tasks.count == 100 ? taskPage.cursor : nil
            let actorList = try await actorsReq.actors
            actorsByID = Dictionary(uniqueKeysWithValues: actorList.map { ($0.id, $0) })
            events = try await eventsReq.events.reversed()
            startLiveStream(api: api)
        } catch OpenBoardAPIError.unauthorized(let message) {
            errorBanner = message
        } catch {
            errorBanner = error.localizedDescription
        }
    }

    func refreshAll() async {
        await bootstrap()
    }

    func refreshChannel(_ channel: String) async {
        guard let api else { return }
        do {
            async let threadsReq = api.listThreads(channel: channel, limit: 80)
            async let tasksReq = api.listTasks(channel: channel, state: "all", limit: 100)
            let fetchedThreads = try await threadsReq.threads
            let fetchedTasks = try await tasksReq.tasks
            threadsByChannel[channel] = fetchedThreads
            mergeChannelTasks(channel: channel, incoming: fetchedTasks)
        } catch {
            errorBanner = error.localizedDescription
        }
    }

    func loadOlderBoardTasks() async {
        guard let api, let cursor = boardTasksNextCursor else { return }
        do {
            let page = try await api.listTasks(state: "all", after: cursor, limit: 100)
            let existingIDs = Set(boardTasks.map(\.id))
            let additions = page.tasks.filter { !existingIDs.contains($0.id) }
            boardTasks.append(contentsOf: additions)
            boardTasksNextCursor = page.tasks.count == 100 ? page.cursor : nil
        } catch {
            errorBanner = error.localizedDescription
        }
    }

    func pureMessages(in channel: String, search: String = "") -> [ThreadSummary] {
        let rows = (threadsByChannel[channel] ?? []).filter { $0.message.task == nil }
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return rows }
        return rows.filter {
            $0.message.text.localizedCaseInsensitiveContains(query) ||
            $0.message.displayAuthor.localizedCaseInsensitiveContains(query)
        }
    }

    func openTasks(in channel: String, search: String = "") -> [ThreadSummary] {
        filterTasks(boardTasks.filter { $0.message.channel == channel && ($0.message.task?.state.isOpen ?? false) }, search: search)
    }

    func doneTasks(in channel: String, search: String = "") -> [ThreadSummary] {
        let done = boardTasks
            .filter { $0.message.channel == channel && ($0.message.task?.state.isTerminal ?? false) }
            .sorted { Self.doneOrder($0, $1) }
        return filterTasks(done, search: search)
    }

    func sortedBoardTasks(channel: String? = nil, stateFilter: BoardTaskFilter) -> [ThreadSummary] {
        let scoped = boardTasks.filter { item in
            guard let state = item.message.task?.state else { return false }
            if let channel, !channel.isEmpty, item.message.channel != channel { return false }
            return stateFilter.matches(state)
        }
        if stateFilter.isTerminalFirst {
            return scoped.sorted { Self.doneOrder($0, $1) }
        }
        return scoped
    }

    func channelEvents(_ channel: String) -> [BoardEvent] {
        events.filter { $0.channelPath == channel }
    }

    func actorDisplayName(for actorID: String) -> String {
        actorsByID[actorID]?.displayText ?? actorID
    }

    func createChannel(path: String) async throws -> ChannelInfo {
        guard let api else { throw OpenBoardAPIError.unauthorized("Not signed in.") }
        let cleaned = path.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let response = try await api.createChannel(path: cleaned)
        if !channels.contains(where: { $0.path == response.channel.path }) {
            channels.append(response.channel)
            channels.sort { $0.path < $1.path }
        }
        return response.channel
    }

    func postMessage(channel: String, text: String, labels: [String: String]? = nil) async throws -> BoardMessage {
        guard let api else { throw OpenBoardAPIError.unauthorized("Not signed in.") }
        let response = try await api.postMessage(
            channel: channel,
            text: text,
            labels: labels,
            idempotencyKey: UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        )
        let summary = ThreadSummary(message: response.message, replies: 0, last: nil)
        var current = threadsByChannel[channel] ?? []
        if !current.contains(where: { $0.id == summary.id }) {
            current.insert(summary, at: 0)
            threadsByChannel[channel] = current
        }
        return response.message
    }

    func createTask(channel: String, text: String, labels: [String: String]? = nil, needs: [String]? = nil) async throws -> BoardMessage {
        guard let api else { throw OpenBoardAPIError.unauthorized("Not signed in.") }
        let response = try await api.createTask(
            channel: channel,
            text: text,
            labels: labels,
            needs: needs,
            idempotencyKey: UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        )
        let summary = ThreadSummary(message: response.task, replies: 0, last: nil)
        if !boardTasks.contains(where: { $0.id == summary.id }) {
            boardTasks.append(summary)
        }
        return response.task
    }

    func recordClaim(taskID: String, claim: LocalTaskClaim?) {
        if let claim {
            localClaims[taskID] = claim
        } else {
            localClaims.removeValue(forKey: taskID)
        }
        KeychainStore.saveClaims(localClaims)
    }

    func activeLocalClaim(for message: BoardMessage) -> LocalTaskClaim? {
        guard let task = message.task, task.state == .claimed,
              let saved = localClaims[message.id], saved.epoch == task.epoch
        else { return nil }
        return saved
    }

    func updateTaskFromMutation(_ taskMessage: BoardMessage) {
        if let idx = boardTasks.firstIndex(where: { $0.id == taskMessage.id }) {
            let existing = boardTasks[idx]
            boardTasks[idx] = ThreadSummary(message: taskMessage, replies: existing.replies, last: existing.last)
        } else {
            boardTasks.append(ThreadSummary(message: taskMessage, replies: 0, last: nil))
        }
    }

    // MARK: - Live SSE

    private func startLiveStream(api: OpenBoardAPI) {
        let stream = eventStream
        Task { [weak self] in
            await stream.start(
                api: api,
                onState: { [weak self] state in
                    Task { @MainActor [weak self] in
                        self?.liveState = state
                    }
                },
                onEvent: { [weak self] event in
                    Task { @MainActor [weak self] in
                        self?.handleLiveEvent(event)
                    }
                }
            )
        }
    }

    private func handleLiveEvent(_ event: BoardEvent) {
        if !activityPaused && !events.contains(where: { $0.cursor == event.cursor }) {
            events.insert(event, at: 0)
            if events.count > 200 { events.removeLast(events.count - 200) }
        }
        if event.type == "channel.created", let ch = event.channelPath {
            if !channels.contains(where: { $0.path == ch }) {
                channels.append(ChannelInfo(path: ch, lastIndex: nil, messages: 0, threads: 0))
                channels.sort { $0.path < $1.path }
            }
        }
        if event.type.hasPrefix("task.") || event.type == "labels.changed" || event.type == "message.edited" || event.type == "message.deleted" {
            scheduleBoardTasksRefresh()
        }
        if let ch = event.channelPath, threadsByChannel[ch] != nil {
            scheduleChannelRefresh(ch)
        }
    }

    private func scheduleChannelRefresh(_ channel: String) {
        refreshTasks[channel]?.cancel()
        refreshTasks[channel] = Task {
            try? await Task.sleep(for: .milliseconds(200))
            guard !Task.isCancelled else { return }
            await refreshChannel(channel)
        }
    }

    private func scheduleBoardTasksRefresh() {
        boardRefreshTask?.cancel()
        boardRefreshTask = Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled, let api else { return }
            if let page = try? await api.listTasks(state: "all", limit: max(100, boardTasks.count)) {
                boardTasks = page.tasks
                boardTasksNextCursor = page.tasks.count >= max(100, boardTasks.count) ? page.cursor : nil
            }
            if let actors = try? await api.listActors().actors {
                actorsByID = Dictionary(uniqueKeysWithValues: actors.map { ($0.id, $0) })
            }
        }
    }

    private func mergeChannelTasks(channel: String, incoming: [ThreadSummary]) {
        let others = boardTasks.filter { $0.message.channel != channel }
        boardTasks = others + incoming
    }

    private func filterTasks(_ list: [ThreadSummary], search: String) -> [ThreadSummary] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return list }
        return list.filter {
            $0.message.text.localizedCaseInsensitiveContains(query) ||
            $0.message.id.localizedCaseInsensitiveContains(query) ||
            $0.message.labels.contains { "\($0.key)=\($0.value)".localizedCaseInsensitiveContains(query) }
        }
    }

    nonisolated static func doneOrder(_ lhs: ThreadSummary, _ rhs: ThreadSummary) -> Bool {
        if lhs.message.version != rhs.message.version {
            return lhs.message.version > rhs.message.version
        }
        return (Int(lhs.message.id) ?? 0) > (Int(rhs.message.id) ?? 0)
    }
}

enum BoardTaskFilter: String, CaseIterable, Identifiable, Sendable {
    case open = "Open"
    case ready = "Ready"
    case claimed = "Claimed"
    case blocked = "Blocked"
    case done = "Done"
    case all = "All"

    var id: String { rawValue }

    var isTerminalFirst: Bool {
        self == .done
    }

    func matches(_ state: TaskStateKind) -> Bool {
        switch self {
        case .open: state.isOpen
        case .ready: state == .ready
        case .claimed: state == .claimed
        case .blocked: state == .blocked
        case .done: state.isTerminal
        case .all: true
        }
    }
}
