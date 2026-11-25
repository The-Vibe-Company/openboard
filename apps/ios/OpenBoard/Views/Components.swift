import SwiftUI

struct LiveStatusBadge: View {
    let state: LiveConnectionState

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(dotColor)
                .frame(width: 7, height: 7)
            Text(label)
                .font(.caption.monospaced())
                .foregroundStyle(OBTheme.muted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Connection \(label)")
    }

    private var dotColor: Color {
        switch state {
        case .connected: OBTheme.success
        case .connecting, .reconnecting: OBTheme.warning
        case .disconnected: OBTheme.faint
        }
    }

    private var label: String {
        switch state {
        case .connected: "live"
        case .connecting: "connecting"
        case .reconnecting: "reconnecting"
        case .disconnected: "offline"
        }
    }
}

struct TaskStateBadgeView: View {
    let task: TaskInfo
    let expired: Bool
    var holderName: String?

    var body: some View {
        let color = expired ? OBTheme.danger : OBTheme.color(for: task.state)
        HStack(spacing: 5) {
            Image(systemName: expired ? "clock.badge.exclamationmark" : task.state.symbolName)
                .font(.system(size: 10, weight: .semibold))
            Text(label)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .lineLimit(1)
        }
        .foregroundStyle(color)
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(color.opacity(0.13))
        .overlay(
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .stroke(color.opacity(0.35), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
    }

    private var label: String {
        if expired { return "expired" }
        if task.state == .claimed, let holderName, !holderName.isEmpty {
            return "claimed · \(holderName)"
        }
        return task.state.rawValue
    }
}

struct AuthorAvatarView: View {
    let name: String
    let avatarURL: String?
    var size: CGFloat = 30

    var body: some View {
        Group {
            if let avatarURL, let url = URL(string: avatarURL) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        monogram
                    }
                }
            } else {
                monogram
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.25, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: size * 0.25, style: .continuous)
                .stroke(OBTheme.hairline, lineWidth: 0.75)
        )
    }

    private var monogram: some View {
        ZStack {
            OBTheme.shade
            Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
                .font(.system(size: size * 0.44, weight: .semibold, design: .monospaced))
                .foregroundStyle(OBTheme.text)
        }
    }
}

struct AuthorKindChip: View {
    let kind: ActorKind?

    var body: some View {
        if kind == .agent || kind == .workflow {
            Text(kind?.rawValue ?? "")
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundStyle(OBTheme.muted)
                .padding(.horizontal, 5)
                .padding(.vertical, 1)
                .background(OBTheme.shade)
                .overlay(
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .stroke(OBTheme.hairline, lineWidth: 0.75)
                )
                .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        }
    }
}

struct TaskRowView: View {
    let summary: ThreadSummary
    let holderName: String?
    var showChannel = false

    var body: some View {
        let message = summary.message
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                Text("#\(message.id)")
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(OBTheme.faint)
                    .frame(minWidth: 34, alignment: .leading)

                Text(message.previewTitle)
                    .font(.system(size: 14, weight: message.task?.state.isTerminal == true ? .regular : .medium))
                    .foregroundStyle(message.task?.state.isTerminal == true ? OBTheme.muted : OBTheme.text)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack(spacing: 8) {
                if let task = message.task {
                    TaskStateBadgeView(task: task, expired: message.isExpiredClaim, holderName: holderName)
                }

                if showChannel {
                    Text("#\(message.channel)")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(OBTheme.muted)
                        .lineLimit(1)
                }

                ForEach(message.visibleLabels.prefix(2), id: \.key) { label in
                    Text("\(label.key)=\(label.value)")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(OBTheme.muted)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(OBTheme.shade)
                        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                        .lineLimit(1)
                }

                Spacer(minLength: 4)

                if summary.replies > 0 {
                    Label("\(summary.replies)", systemImage: "bubble.left")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(OBTheme.faint)
                }

                Text(TextFormatting.relativeAge(summary.latestActivityDate))
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(OBTheme.faint)
            }

            if let detail = terminalDetail(message.task) {
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(OBTheme.muted)
                    .lineLimit(2)
                    .padding(.leading, 42)
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .contentShape(Rectangle())
    }

    private func terminalDetail(_ task: TaskInfo?) -> String? {
        guard let task, task.state.isTerminal else { return nil }
        let raw = task.result ?? task.reason ?? ""
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

struct ThreadRowView: View {
    let summary: ThreadSummary

    var body: some View {
        let message = summary.message
        HStack(alignment: .top, spacing: 11) {
            AuthorAvatarView(name: message.displayAuthor, avatarURL: message.author?.avatar, size: 32)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(message.displayAuthor)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(OBTheme.text)
                        .lineLimit(1)

                    AuthorKindChip(kind: message.author?.kind)

                    Text("·")
                        .foregroundStyle(OBTheme.faint)

                    Text(TextFormatting.relativeAge(summary.latestActivityDate))
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(OBTheme.muted)

                    Spacer(minLength: 4)

                    if summary.replies > 0 {
                        Text("\(summary.replies) \(summary.replies == 1 ? "reply" : "replies")")
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundStyle(OBTheme.muted)
                    }
                }

                Text(message.previewTitle)
                    .font(.system(size: 14))
                    .foregroundStyle(OBTheme.text.opacity(0.88))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                if !message.visibleLabels.isEmpty {
                    HStack(spacing: 5) {
                        ForEach(message.visibleLabels.prefix(3), id: \.key) { label in
                            Text("\(label.key)=\(label.value)")
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(OBTheme.muted)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 1)
                                .background(OBTheme.shade)
                                .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                        }
                    }
                    .padding(.top, 2)
                }
            }
        }
        .padding(.vertical, 11)
        .padding(.horizontal, 14)
        .contentShape(Rectangle())
    }
}

struct ActivityRowView: View {
    let event: BoardEvent

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            AuthorAvatarView(name: event.actorName, avatarURL: event.message?.author?.avatar, size: 28)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(event.actorName)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(OBTheme.text)
                        .lineLimit(1)

                    if let ch = event.channelPath {
                        Text("#\(ch)")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(OBTheme.muted)
                    }

                    Spacer(minLength: 4)

                    Text(TextFormatting.relativeAge(event.createdAt))
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(OBTheme.faint)
                }

                HStack(spacing: 6) {
                    Text(event.type)
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(eventColor)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(eventColor.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))

                    Text(event.summaryText)
                        .font(.system(size: 13))
                        .foregroundStyle(OBTheme.muted)
                        .lineLimit(2)
                }
            }
        }
        .padding(.vertical, 9)
        .padding(.horizontal, 14)
        .contentShape(Rectangle())
    }

    private var eventColor: Color {
        if event.type.contains("completed") { return OBTheme.success }
        if event.type.contains("failed") || event.type.contains("deleted") { return OBTheme.danger }
        if event.type.contains("claimed") { return OBTheme.warning }
        if event.type.hasPrefix("task.") { return OBTheme.accent }
        return OBTheme.muted
    }
}

enum ComposerMode: String, CaseIterable, Identifiable {
    case message = "Message"
    case task = "Task"

    var id: String { rawValue }
}

struct ComposerBarView: View {
    let allowTask: Bool
    @Binding var mode: ComposerMode
    @Binding var text: String
    let placeholder: String
    let isSending: Bool
    let onSend: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            if allowTask {
                HStack(spacing: 6) {
                    ForEach(ComposerMode.allCases) { item in
                        Button {
                            mode = item
                            Haptics.light()
                        } label: {
                            Text(item.rawValue)
                                .font(.system(size: 12, weight: mode == item ? .semibold : .medium))
                                .foregroundStyle(mode == item ? OBTheme.text : OBTheme.muted)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(mode == item ? OBTheme.shade : .clear)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                                        .stroke(mode == item ? OBTheme.hairline : .clear, lineWidth: 1)
                                )
                                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                        }
                    }
                    Spacer()
                }
            }

            HStack(alignment: .bottom, spacing: 8) {
                TextField(placeholder, text: $text, axis: .vertical)
                    .lineLimit(1...5)
                    .font(.system(size: 15))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(OBTheme.background)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(OBTheme.hairline, lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                Button(action: onSend) {
                    Group {
                        if isSending {
                            ProgressView()
                                .tint(OBTheme.background)
                        } else {
                            Image(systemName: mode == .task && allowTask ? "plus" : "arrow.up")
                                .font(.system(size: 15, weight: .bold))
                        }
                    }
                    .frame(width: 38, height: 38)
                    .background(canSend ? OBTheme.text : OBTheme.shade)
                    .foregroundStyle(canSend ? OBTheme.background : OBTheme.faint)
                    .clipShape(Circle())
                }
                .disabled(!canSend || isSending)
                .accessibilityLabel(mode == .task && allowTask ? "Create task" : "Post message")
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 10)
        .background(OBTheme.surface)
        .overlay(alignment: .top) {
            Rectangle().fill(OBTheme.hairline).frame(height: 0.75)
        }
    }

    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
