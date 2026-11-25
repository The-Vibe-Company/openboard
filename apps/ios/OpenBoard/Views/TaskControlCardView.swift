import SwiftUI

enum TaskPromptKind: Identifiable {
    case complete
    case fail
    case hold
    case cancel

    var id: String {
        switch self {
        case .complete: "complete"
        case .fail: "fail"
        case .hold: "hold"
        case .cancel: "cancel"
        }
    }

    var title: String {
        switch self {
        case .complete: "Complete task"
        case .fail: "Mark task failed"
        case .hold: "Put task on hold"
        case .cancel: "Cancel task"
        }
    }

    var placeholder: String {
        switch self {
        case .complete: "Summary or deliverable (optional)"
        case .fail: "Why did it fail?"
        case .hold: "What is blocking this task?"
        case .cancel: "Reason for canceling"
        }
    }

    var requiresText: Bool {
        self != .complete
    }

    var confirmLabel: String {
        switch self {
        case .complete: "Complete"
        case .fail: "Mark Failed"
        case .hold: "Hold"
        case .cancel: "Cancel Task"
        }
    }
}

struct TaskControlCardView: View {
    @Environment(BoardStore.self) private var store

    let message: BoardMessage
    let task: TaskInfo
    let isWorking: Bool
    let onClaim: () -> Void
    let onRelease: (LocalTaskClaim) -> Void
    let onUnblock: () -> Void
    let onPrompt: (TaskPromptKind) -> Void

    var body: some View {
        let localClaim = store.activeLocalClaim(for: message)
        let holderName = task.claim.map { store.actorDisplayName(for: $0.actor) }

        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                TaskStateBadgeView(task: task, expired: message.isExpiredClaim, holderName: holderName)
                Spacer()
                Text("task #\(message.id)")
                    .font(.caption.monospaced())
                    .foregroundStyle(OBTheme.faint)
            }

            VStack(alignment: .leading, spacing: 4) {
                metaLine("Owner", store.actorDisplayName(for: task.owner))
                if let assigned = task.assignedTo {
                    metaLine("For", store.actorDisplayName(for: assigned))
                }
                if let claim = task.claim {
                    metaLine("Claimed by", "\(store.actorDisplayName(for: claim.actor)) · until \(TextFormatting.relativeAge(claim.until))")
                }
            }

            if !task.needs.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        Text("Needs:")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(OBTheme.muted)
                        ForEach(task.needs, id: \.self) { depID in
                            NavigationLink(value: ThreadRoute(id: depID)) {
                                Text("#\(depID)")
                                    .font(.caption.monospaced().weight(.medium))
                                    .foregroundStyle(OBTheme.accent)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 3)
                                    .background(OBTheme.accent.opacity(0.12))
                                    .clipShape(Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            if let blocked = task.blocked, !blocked.reason.isEmpty {
                callout(title: "On hold", body: blocked.reason, color: OBTheme.purple)
            }

            if let result = task.result, !result.isEmpty {
                callout(title: "Result", body: result, color: OBTheme.success)
            }

            if let reason = task.reason, !reason.isEmpty {
                callout(title: task.state == .failed ? "Failure reason" : "Reason", body: reason, color: OBTheme.danger)
            }

            if task.state.isOpen {
                actionStrip(localClaim: localClaim)
            }
        }
        .padding(12)
        .background(OBTheme.surface)
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(OBTheme.hairline, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func metaLine(_ key: String, _ value: String) -> some View {
        HStack(spacing: 6) {
            Text(key)
                .font(.caption)
                .foregroundStyle(OBTheme.faint)
                .frame(width: 72, alignment: .leading)
            Text(value)
                .font(.caption.weight(.medium))
                .foregroundStyle(OBTheme.muted)
                .lineLimit(1)
        }
    }

    private func callout(title: String, body: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title.uppercased())
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(color)
            Text(body)
                .font(.footnote)
                .foregroundStyle(OBTheme.text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(9)
        .background(color.opacity(0.09))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(color.opacity(0.25), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    @ViewBuilder
    private func actionStrip(localClaim: LocalTaskClaim?) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if task.state == .ready {
                    actionButton("Claim", icon: "hand.raised.fill", primary: true, action: onClaim)
                }

                if task.state == .claimed, let localClaim {
                    actionButton("Complete", icon: "checkmark", primary: true, tint: OBTheme.success) {
                        onPrompt(.complete)
                    }
                    actionButton("Fail", icon: "xmark", tint: OBTheme.danger) {
                        onPrompt(.fail)
                    }
                    actionButton("Release", icon: "arrow.uturn.backward") {
                        onRelease(localClaim)
                    }
                }

                if task.state == .blocked {
                    actionButton("Unblock", icon: "play.fill", primary: true, action: onUnblock)
                } else if task.state == .ready || task.state == .waiting || (task.state == .claimed && localClaim != nil) {
                    actionButton("Hold", icon: "pause.fill") {
                        onPrompt(.hold)
                    }
                }

                actionButton("Cancel", icon: "slash.circle", tint: OBTheme.danger) {
                    onPrompt(.cancel)
                }
            }
            .padding(.top, 2)
        }
        .disabled(isWorking)
    }

    private func actionButton(
        _ title: String,
        icon: String,
        primary: Bool = false,
        tint: Color? = nil,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(primary ? OBTheme.background : (tint ?? OBTheme.text))
                .padding(.horizontal, 11)
                .padding(.vertical, 7)
                .background(primary ? (tint ?? OBTheme.text) : OBTheme.background)
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(primary ? .clear : (tint ?? OBTheme.hairline).opacity(tint == nil ? 1 : 0.4), lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
