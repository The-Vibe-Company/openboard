import Foundation
import Observation

@Observable
@MainActor
final class BoardStore {
    private(set) var session: SavedSession?
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
    private(set) var generation = UUID()
    private(set) var threadInvalidations: [String: Int] = [:]
    private var localClaims = KeychainStore.loadClaims()
    private let eventStream = BoardEventStream()
    private var refreshTasks: [String: Task<Void, Never>] = [:]
    private var boardRefreshTask: Task<Void, Never>?
    private var pending = (tasks: false, actors: false)

    var api: OpenBoardAPI? {
        session.map { OpenBoardAPI(session: $0) }
    }

    init() {
        let savedAppearance = UserDefaults.standard.string(forKey: "ob.appearance")
        self.appearance = savedAppearance.flatMap(AppearancePreference.init(rawValue:)) ?? .system
        if let saved = KeychainStore.loadSession() {
            self.session = saved
            Task { await bootstrap() }
        }
    }

    func completeSignIn(_ newSession: SavedSession) async {
        KeychainStore.saveSession(newSession)
        reset(to: newSession)
        await bootstrap()
    }

    func switchBoard(slug: String) async {
        guard var current = session, current.board != slug else { return }
        current.board = slug
        KeychainStore.saveSession(current)
        reset(to: current)
        await bootstrap()
    }

    func signOut() {
        KeychainStore.clearSession()
        localClaims = [:]
        reset(to: nil)
    }

    func isCurrent(_ generation: UUID) -> Bool {
        self.generation == generation && !Task.isCancelled
    }

    private func reset(to session: SavedSession?) {
        generation = UUID()
        eventStream.stop()
        refreshTasks.values.forEach { $0.cancel() }
        refreshTasks = [:]
        boardRefreshTask?.cancel()
        boardRefreshTask = nil
        pending = (false, false)
        threadInvalidations = [:]
        self.session = session
        me = nil
        channels = []
        boardTasks = []
        boardTasksNextCursor = nil
        actorsByID = [:]
        events = []
        threadsByChannel = [:]
        isBootstrapping = false
        liveState = .disconnected
        errorBanner = nil
    }

    func bootstrap() async {
        guard let api, !isBootstrapping else { return }
        let generation = self.generation
        isBootstrapping = true
        errorBanner = nil
        defer { if self.generation == generation { isBootstrapping = false } }
        do {
            let limit = OpenBoardAPI.taskPageLimit(max(100, boardTasks.count))
            let history = try await api.readEvents(last: 80, all: true)
            guard isCurrent(generation) else { return }
            async let meReq = api.getMe()
            async let channelsReq = api.listChannels()
            async let tasksReq = api.listTasks(state: "all", limit: limit)
            async let actorsReq = api.listActors()
            let (identity, channelList, taskPage, actors) = try await (meReq, channelsReq, tasksReq, actorsReq)
            guard isCurrent(generation) else { return }
            me = identity
            channels = channelList.channels.sorted { $0.path < $1.path }
            applyTaskPage(taskPage, limit: limit)
            actorsByID = Dictionary(uniqueKeysWithValues: actors.actors.map { ($0.id, $0) })
            events = Array(history.events.reversed())
            startLiveStream(api: api, initialCursor: history.cursor, generation: generation)
        } catch {
            if isCurrent(generation) { errorBanner = error.localizedDescription }
        }
    }

    func refreshAll() async {
        await bootstrap()
    }

    func refreshChannel(_ channel: String) async {
        guard let api else { return }
        let generation = self.generation
        do {
            async let threadsReq = api.listThreads(channel: channel, limit: 80)
            async let tasksReq = api.listTasks(channel: channel, state: "all", limit: 100)
            let fetchedThreads = try await threadsReq.threads
            let fetchedTasks = try await tasksReq.tasks
            guard isCurrent(generation) else { return }
            threadsByChannel[channel] = fetchedThreads
            boardTasks = Self.mergeTasks(boardTasks, incoming: fetchedTasks)
        } catch {
            if isCurrent(generation) { errorBanner = error.localizedDescription }
        }
    }

    func loadOlderBoardTasks() async {
        guard let api, let cursor = boardTasksNextCursor else { return }
        let generation = self.generation
        do {
            let page = try await api.listTasks(state: "all", after: cursor, limit: 100)
            guard isCurrent(generation), boardTasksNextCursor == cursor else { return }
            let existingIDs = Set(boardTasks.map(\.id))
            boardTasks.append(contentsOf: page.tasks.filter { !existingIDs.contains($0.id) })
            boardTasksNextCursor = page.tasks.count == 100 ? page.cursor : nil
        } catch {
            if isCurrent(generation) { errorBanner = error.localizedDescription }
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
        let generation = self.generation
        let cleaned = path.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let response = try await api.createChannel(path: cleaned)
        guard isCurrent(generation) else { throw CancellationError() }
        if !channels.contains(where: { $0.path == response.channel.path }) {
            channels.append(response.channel)
            channels.sort { $0.path < $1.path }
        }
        return response.channel
    }

    func postMessage(channel: String, text: String, labels: [String: String]? = nil) async throws -> BoardMessage {
        guard let api else { throw OpenBoardAPIError.unauthorized("Not signed in.") }
        let generation = self.generation
        let response = try await api.postMessage(
            channel: channel,
            text: text,
            labels: labels,
            idempotencyKey: UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        )
        guard isCurrent(generation) else { throw CancellationError() }
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
        let generation = self.generation
        let response = try await api.createTask(
            channel: channel,
            text: text,
            labels: labels,
            needs: needs,
            idempotencyKey: UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        )
        guard isCurrent(generation) else { throw CancellationError() }
        let summary = ThreadSummary(message: response.task, replies: 0, last: nil)
        if !boardTasks.contains(where: { $0.id == summary.id }) {
            boardTasks.append(summary)
        }
        return response.task
    }

    func recordClaim(taskID: String, claim: LocalTaskClaim?) {
        guard let api, let actor = me?.actor else { return }
        let scope = ClaimScope(api: api, actor: actor, taskID: taskID)
        localClaims[scope] = claim
        if !KeychainStore.saveClaims(localClaims) {
            errorBanner = "Could not save task claims to Keychain."
        }
    }

    func activeLocalClaim(for message: BoardMessage) -> LocalTaskClaim? {
        guard let api, let actor = me?.actor, let task = message.task,
              task.state == .claimed, task.claim?.actor == actor else { return nil }
        return ClaimScope(api: api, actor: actor, taskID: message.id)
            .activeClaim(in: localClaims, epoch: task.epoch, now: Date())
    }

    func updateTaskFromMutation(_ taskMessage: BoardMessage) {
        if let idx = boardTasks.firstIndex(where: { $0.id == taskMessage.id }) {
            let existing = boardTasks[idx]
            boardTasks[idx] = ThreadSummary(message: taskMessage, replies: existing.replies, last: existing.last)
        } else {
            boardTasks.append(ThreadSummary(message: taskMessage, replies: 0, last: nil))
        }
    }

    private func startLiveStream(api: OpenBoardAPI, initialCursor: String, generation: UUID) {
        eventStream.start(api: api, initialCursor: initialCursor, onState: { [weak self] state in
            guard let self, isCurrent(generation) else { return }
            liveState = state
        }, onEvent: { [weak self] event in
            guard let self, isCurrent(generation) else { return }
            handleLiveEvent(event)
        })
    }

    func invalidateThread(_ id: String) {
        threadInvalidations[id, default: 0] += 1
    }

    private func handleLiveEvent(_ event: BoardEvent) {
        if let id = event.threadID ?? event.message?.id { invalidateThread(id) }
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
        let refreshTasks = event.type.hasPrefix("task.") || ["labels.changed", "message.edited", "message.deleted"].contains(event.type)
        let actor = event.payload?.by?.actor ?? event.message?.by.actor
        let refreshActors = event.type == "actor.seen" || actor.map { actorsByID[$0] == nil } == true
        if refreshTasks, let message = event.message {
            if let state = message.task?.state, !message.deleted || state == .completed || state == .canceled {
                updateTaskFromMutation(message)
            } else if message.deleted {
                boardTasks.removeAll { $0.id == message.id }
            }
        }
        if refreshTasks || refreshActors { scheduleBoardRefresh(tasks: refreshTasks, actors: refreshActors) }
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

    private func scheduleBoardRefresh(tasks: Bool, actors: Bool) {
        pending.tasks = pending.tasks || tasks
        pending.actors = pending.actors || actors
        guard boardRefreshTask == nil, let api else { return }
        let generation = self.generation
        boardRefreshTask = Task {
            while isCurrent(generation), pending.tasks || pending.actors {
                try? await Task.sleep(for: .milliseconds(250))
                guard isCurrent(generation) else { return }
                let limit = OpenBoardAPI.taskPageLimit(max(100, boardTasks.count))
                let (tasks, actors) = (pending.tasks, pending.actors)
                pending = (false, false)
                if tasks, let page = try? await api.listTasks(limit: limit), isCurrent(generation) {
                    applyTaskPage(page, limit: limit)
                }
                if isCurrent(generation), actors, let list = try? await api.listActors(), isCurrent(generation) {
                    actorsByID = Dictionary(uniqueKeysWithValues: list.actors.map { ($0.id, $0) })
                }
            }
            if isCurrent(generation) { boardRefreshTask = nil }
        }
    }

    private func applyTaskPage(_ page: TasksResponse, limit: Int) {
        let refreshedIDs = Set(page.tasks.map(\.id))
        if page.tasks.count == limit && boardTasks.contains(where: { !refreshedIDs.contains($0.id) }) {
            boardTasks = Self.mergeTasks(boardTasks, incoming: page.tasks)
        } else {
            boardTasks = page.tasks
            boardTasksNextCursor = page.tasks.count == limit ? page.cursor : nil
        }
    }

    nonisolated static func mergeTasks(_ loaded: [ThreadSummary], incoming: [ThreadSummary]) -> [ThreadSummary] {
        let updatedIDs = Set(incoming.map(\.id))
        return incoming + loaded.filter { !updatedIDs.contains($0.id) }
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
