import Foundation

enum AppearancePreference: String, CaseIterable, Identifiable, Codable, Sendable {
    case system
    case dark
    case light

    var id: String { rawValue }
    var label: String {
        switch self {
        case .system: "System"
        case .dark: "Dark"
        case .light: "Light"
        }
    }
}

struct SavedSession: Codable, Equatable, Sendable {
    var origin: String
    var org: String
    var board: String
    var token: String
    var orgName: String?
    var boards: [BoardRef]

    static let productionOrigin = "https://openboard.thevibecompany.co"

    var baseBoardAPIURL: URL? {
        let trimmed = origin.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return URL(string: "\(trimmed)/api/\(org)/\(board)")
    }
}

struct BoardRef: Codable, Equatable, Hashable, Identifiable, Sendable {
    let slug: String
    let name: String
    let url: String?

    var id: String { slug }
}

struct OrgRef: Codable, Equatable, Hashable, Sendable {
    let slug: String
    let name: String
}

struct DeviceStartResponse: Codable, Sendable {
    let deviceCode: String
    let userCode: String
    let verificationUri: String
    let interval: Int
    let expiresIn: Int
}

struct DevicePollResponse: Codable, Sendable {
    let pending: Bool?
    let token: String?
    let org: OrgRef?
    let boards: [BoardRef]?
}

struct MeResponse: Codable, Sendable {
    let actor: String
    let principal: String
    let kind: ActorKind
    let handle: String
    let name: String
    let avatar: String?
    let openboard: MeOpenBoard?
}

struct MeOpenBoard: Codable, Sendable {
    let org: OrgRef
    let board: OrgRef
    let role: String?
    let credential: String
}

enum ActorKind: String, Codable, Sendable {
    case person
    case agent
    case workflow
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ActorKind(rawValue: raw) ?? .unknown
    }
}

struct MessageAuthor: Codable, Equatable, Sendable {
    struct Via: Codable, Equatable, Sendable {
        let name: String
    }

    let kind: ActorKind
    let handle: String
    let name: String
    let avatar: String?
    let via: Via?
}

struct MessageBy: Codable, Equatable, Sendable {
    let actor: String
    let principal: String
    let profile: String?
}

struct MessageMention: Codable, Equatable, Sendable {
    struct MentionActor: Codable, Equatable, Sendable {
        let id: String
        let handle: String
        let name: String
    }

    let written: String
    let actor: MentionActor?
}

struct AttachmentInfo: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let type: String
    let size: Int
}

enum TaskStateKind: String, Codable, CaseIterable, Sendable {
    case waiting
    case ready
    case claimed
    case blocked
    case completed
    case failed
    case canceled

    var isOpen: Bool {
        switch self {
        case .waiting, .ready, .claimed, .blocked: true
        case .completed, .failed, .canceled: false
        }
    }

    var isTerminal: Bool { !isOpen }

    var symbolName: String {
        switch self {
        case .waiting: "clock"
        case .ready: "circle"
        case .claimed: "dot.circle.fill"
        case .blocked: "pause.circle.fill"
        case .completed: "checkmark.circle.fill"
        case .failed: "xmark.circle.fill"
        case .canceled: "slash.circle"
        }
    }
}

struct TaskClaimInfo: Codable, Equatable, Sendable {
    let actor: String
    let until: String
}

struct TaskBlockedInfo: Codable, Equatable, Sendable {
    let kind: String?
    let reason: String
}

struct TaskInfo: Codable, Equatable, Sendable {
    let state: TaskStateKind
    let owner: String
    let by: String
    let assignedTo: String?
    let needs: [String]
    let epoch: Int
    let claim: TaskClaimInfo?
    let blocked: TaskBlockedInfo?
    let result: String?
    let reason: String?

    enum CodingKeys: String, CodingKey {
        case state, owner, by
        case assignedTo = "for"
        case needs, epoch, claim, blocked, result, reason
    }
}

struct LocalTaskClaim: Codable, Equatable, Sendable {
    let epoch: Int
    let token: String
    let until: String
}

struct BoardMessage: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let channel: String
    let text: String
    let mentions: [MessageMention]?
    let re: String?
    let replyTo: String?
    let thread: String
    let labels: [String: String]
    let reactions: [String: [String]]
    let by: MessageBy
    let from: String?
    let createdAt: String
    let editedAt: String?
    let deleted: Bool
    let attachments: [AttachmentInfo]?
    let version: Int
    let task: TaskInfo?
    let revision: Int
    let author: MessageAuthor?

    var displayAuthor: String {
        author?.name ?? from ?? by.profile ?? by.actor
    }

    var visibleLabels: [(key: String, value: String)] {
        labels
            .filter { !$0.key.hasPrefix("board.") }
            .sorted { $0.key < $1.key }
            .map { (key: $0.key, value: $0.value) }
    }

    var isExpiredClaim: Bool {
        task?.state == .ready && labels["board.task"] == "claimed"
    }

    var previewTitle: String {
        if deleted { return "Message deleted" }
        return TextFormatting.previewLine(text, mentions: mentions, fallback: "Thread #\(id)")
    }
}

struct ThreadSummary: Codable, Equatable, Identifiable, Sendable {
    let message: BoardMessage
    let replies: Int
    let last: BoardMessage?

    var id: String { message.id }
    var latestActivityDate: String { (last ?? message).createdAt }
}

struct ThreadDetail: Codable, Equatable, Sendable {
    let message: BoardMessage
    let replies: [BoardMessage]
    let cursor: String?
}

struct ChannelInfo: Codable, Equatable, Identifiable, Hashable, Sendable {
    let path: String
    let lastIndex: Int?
    let messages: Int?
    let threads: Int?

    var id: String { path }
}

struct ActorInfo: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let kind: ActorKind
    let handle: String
    let name: String
    let avatar: String?
    let via: MessageAuthor.Via?

    var displayText: String {
        if let via = via?.name { return "\(name) via \(via)" }
        return name
    }
}

struct BoardEvent: Codable, Equatable, Identifiable, Sendable {
    struct Payload: Codable, Equatable, Sendable {
        let channel: String?
        let thread: String?
        let name: String?
        let handle: String?
        let error: String?
        let by: MessageBy?
    }

    let cursor: String
    let type: String
    let createdAt: String
    let message: BoardMessage?
    let payload: Payload?

    var id: String { cursor }

    var channelPath: String? {
        message?.channel ?? payload?.channel
    }

    var threadID: String? {
        message?.thread ?? payload?.thread
    }

    var actorName: String {
        if let author = message?.author?.name { return author }
        if let profile = payload?.by?.profile { return profile }
        if let actor = payload?.by?.actor { return actor }
        if let name = payload?.name, !name.isEmpty { return name }
        if let handle = payload?.handle, !handle.isEmpty { return handle }
        return "System"
    }

    var summaryText: String {
        if let message {
            return message.previewTitle
        }
        if type == "channel.created", let ch = payload?.channel {
            return "Created channel #\(ch)"
        }
        if type == "actor.seen" {
            let who = payload?.name ?? payload?.handle ?? "actor"
            return "Actor \(who) active"
        }
        if type == "watch.failed", let err = payload?.error {
            return "Watcher failed: \(err)"
        }
        return type
    }

    enum Category: String, CaseIterable, Identifiable, Sendable {
        case all = "All"
        case messages = "Messages"
        case tasks = "Tasks"
        case system = "System"

        var id: String { rawValue }
    }

    var category: Category {
        if type.hasPrefix("task.") { return .tasks }
        if type.hasPrefix("message.") { return .messages }
        return .system
    }
}

struct ChannelsResponse: Codable, Sendable {
    let channels: [ChannelInfo]
    let cursor: String
    let next: String?
}

struct ThreadsResponse: Codable, Sendable {
    let threads: [ThreadSummary]
    let cursor: String
    let older: String?
}

struct TasksResponse: Codable, Sendable {
    let tasks: [ThreadSummary]
    let cursor: String
}

struct ActorsResponse: Codable, Sendable {
    let actors: [ActorInfo]
    let cursor: String
}

struct EventsResponse: Codable, Sendable {
    let events: [BoardEvent]
    let cursor: String
}

struct PostMessageResponse: Codable, Sendable {
    let message: BoardMessage
}

struct TaskMutationResponse: Codable, Sendable {
    let task: BoardMessage
    let claim: LocalTaskClaim?
}

struct CreateChannelResponse: Codable, Sendable {
    let channel: ChannelInfo
    let created: Bool
}

struct APIErrorEnvelope: Codable, Sendable {
    struct Body: Codable, Sendable {
        let code: String
        let message: String
        let hint: String?
    }
    let error: Body
}
