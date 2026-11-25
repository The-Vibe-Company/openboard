import SwiftUI

struct ThreadDetailView: View {
    @Environment(BoardStore.self) private var store

    let threadID: String

    @State private var detail: ThreadDetail?
    @State private var isLoading = true
    @State private var errorMessage: String?

    @State private var replyMode: ComposerMode = .message
    @State private var replyText = ""
    @State private var isSendingReply = false

    @State private var activeTaskAction = false
    @State private var promptKind: TaskPromptKind?
    @State private var promptText = ""

    @State private var editingMessage: BoardMessage?
    @State private var editDraft = ""

    private let quickReactions: [(key: String, glyph: String)] = [
        ("thumbs_up", "👍"),
        ("rocket", "🚀"),
        ("eyes", "👀"),
        ("fire", "🔥"),
        ("white_check_mark", "✅"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if let errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(OBTheme.danger)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                    }

                    if isLoading && detail == nil {
                        ProgressView("Loading thread…")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 60)
                    } else if let detail {
                        if let task = detail.message.task {
                            TaskControlCardView(
                                message: detail.message,
                                task: task,
                                isWorking: activeTaskAction,
                                onClaim: { Task { await runClaim(id: detail.message.id) } },
                                onRelease: { claim in Task { await runRelease(id: detail.message.id, claim: claim) } },
                                onUnblock: { Task { await runUnblock(id: detail.message.id) } },
                                onPrompt: { kind in
                                    promptText = ""
                                    promptKind = kind
                                }
                            )
                            .padding(.horizontal, 12)
                            .padding(.top, 12)
                        }

                        messageBlock(detail.message, isRoot: true)

                        if !detail.replies.isEmpty {
                            HStack(spacing: 8) {
                                Text("\(detail.replies.count) \(detail.replies.count == 1 ? "REPLY" : "REPLIES")")
                                    .font(.system(size: 11, weight: .semibold))
                                    .tracking(0.7)
                                    .foregroundStyle(OBTheme.muted)
                                Rectangle().fill(OBTheme.hairline).frame(height: 0.75)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)

                            ForEach(detail.replies) { reply in
                                messageBlock(reply, isRoot: false)
                                Rectangle()
                                    .fill(OBTheme.hairline)
                                    .frame(height: 0.75)
                                    .padding(.leading, 54)
                            }
                        }
                    }
                }
                .padding(.bottom, 20)
            }
            .background(OBTheme.background)
            .refreshable {
                await loadThread()
            }

            ComposerBarView(
                allowTask: false,
                mode: $replyMode,
                text: $replyText,
                placeholder: "Reply to #\(threadID)…",
                isSending: isSendingReply,
                onSend: { Task { await submitReply() } }
            )
        }
        .background(OBTheme.background)
        .navigationTitle(detail.map { "#\($0.message.channel) · #\($0.message.id)" } ?? "#\(threadID)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                LiveStatusBadge(state: store.liveState)
            }
        }
        .task(id: threadID) {
            await loadThread()
        }
        .onChange(of: store.events.first?.cursor) { _, _ in
            guard let latest = store.events.first else { return }
            if latest.threadID == threadID || latest.message?.id == threadID {
                Task { await loadThread(silent: true) }
            }
        }
        .sheet(item: $promptKind) { kind in
            taskPromptSheet(kind)
        }
        .sheet(item: $editingMessage) { msg in
            editMessageSheet(msg)
        }
    }

    private func messageBlock(_ message: BoardMessage, isRoot: Bool) -> some View {
        let isMine = store.me?.actor == message.by.actor

        return HStack(alignment: .top, spacing: 11) {
            AuthorAvatarView(name: message.displayAuthor, avatarURL: message.author?.avatar, size: isRoot ? 34 : 28)

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text(message.displayAuthor)
                        .font(.system(size: isRoot ? 15 : 14, weight: .semibold))
                        .foregroundStyle(OBTheme.text)
                        .lineLimit(1)

                    AuthorKindChip(kind: message.author?.kind)

                    Text("·")
                        .foregroundStyle(OBTheme.faint)

                    Text(TextFormatting.relativeAge(message.createdAt))
                        .font(.caption.monospaced())
                        .foregroundStyle(OBTheme.muted)

                    if message.editedAt != nil {
                        Text("edited")
                            .font(.caption2.monospaced())
                            .foregroundStyle(OBTheme.faint)
                    }

                    Spacer(minLength: 4)

                    if isMine && !message.deleted {
                        Menu {
                            Button {
                                editingMessage = message
                                editDraft = message.text
                            } label: {
                                Label("Edit", systemImage: "pencil")
                            }
                            Button(role: .destructive) {
                                Task { await runDelete(message) }
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        } label: {
                            Image(systemName: "ellipsis")
                                .font(.caption)
                                .foregroundStyle(OBTheme.muted)
                                .padding(6)
                        }
                    }
                }

                if message.deleted {
                    Text("Message deleted")
                        .font(.subheadline.italic())
                        .foregroundStyle(OBTheme.faint)
                } else {
                    Text(TextFormatting.markdownAttributed(message.text, mentions: message.mentions))
                        .font(.system(size: isRoot ? 15 : 14.5))
                        .foregroundStyle(OBTheme.text)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !message.visibleLabels.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(message.visibleLabels, id: \.key) { label in
                                Text("\(label.key)=\(label.value)")
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(OBTheme.muted)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(OBTheme.shade)
                                    .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                            }
                        }
                    }
                }

                if !message.deleted {
                    reactionsStrip(for: message)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, isRoot ? 14 : 11)
    }

    private func reactionsStrip(for message: BoardMessage) -> some View {
        let sortedReactions = message.reactions
            .filter { !$0.value.isEmpty }
            .sorted { $0.key < $1.key }

        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(sortedReactions, id: \.key) { emoji, actors in
                    let mine = store.me.map { actors.contains($0.actor) } ?? false
                    Button {
                        Task { await toggleReaction(messageID: message.id, emoji: emoji, remove: mine) }
                    } label: {
                        HStack(spacing: 4) {
                            Text(displayEmoji(emoji))
                                .font(.caption)
                            Text("\(actors.count)")
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                                .foregroundStyle(mine ? OBTheme.accent : OBTheme.muted)
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(mine ? OBTheme.accent.opacity(0.14) : OBTheme.shade)
                        .overlay(
                            Capsule().stroke(mine ? OBTheme.accent.opacity(0.45) : OBTheme.hairline, lineWidth: 0.75)
                        )
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }

                Menu {
                    ForEach(quickReactions, id: \.key) { item in
                        let actors = message.reactions[item.key] ?? []
                        let mine = store.me.map { actors.contains($0.actor) } ?? false
                        Button {
                            Task { await toggleReaction(messageID: message.id, emoji: item.key, remove: mine) }
                        } label: {
                            Text("\(item.glyph) \(item.key)")
                        }
                    }
                } label: {
                    Image(systemName: "face.smiling")
                        .font(.caption)
                        .foregroundStyle(OBTheme.faint)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(OBTheme.shade)
                        .clipShape(Capsule())
                }
            }
            .padding(.top, 2)
        }
    }

    private func displayEmoji(_ key: String) -> String {
        quickReactions.first(where: { $0.key == key })?.glyph ?? key
    }

    private func taskPromptSheet(_ kind: TaskPromptKind) -> some View {
        NavigationStack {
            Form {
                Section {
                    TextField(kind.placeholder, text: $promptText, axis: .vertical)
                        .lineLimit(3...6)
                }
            }
            .navigationTitle(kind.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { promptKind = nil }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(kind.confirmLabel) {
                        let chosen = kind
                        let input = promptText.trimmingCharacters(in: .whitespacesAndNewlines)
                        promptKind = nil
                        Task { await runPromptedAction(chosen, input: input) }
                    }
                    .disabled(kind.requiresText && promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .presentationDetents([.height(250)])
    }

    private func editMessageSheet(_ message: BoardMessage) -> some View {
        NavigationStack {
            Form {
                Section("Edit message") {
                    TextField("Message text", text: $editDraft, axis: .vertical)
                        .lineLimit(3...10)
                }
            }
            .navigationTitle("Edit Message")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { editingMessage = nil }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        let draft = editDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                        editingMessage = nil
                        Task { await runEdit(message, newText: draft) }
                    }
                    .disabled(editDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: - Actions

    private func loadThread(silent: Bool = false) async {
        guard let api = store.api else { return }
        if !silent { isLoading = true }
        defer { isLoading = false }
        do {
            detail = try await api.readThread(id: threadID)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func submitReply() async {
        let trimmed = replyText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSendingReply, let api = store.api else { return }
        isSendingReply = true
        errorMessage = nil
        defer { isSendingReply = false }
        do {
            _ = try await api.postMessage(
                re: threadID,
                text: trimmed,
                idempotencyKey: UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
            )
            replyText = ""
            Haptics.success()
            await loadThread(silent: true)
        } catch {
            errorMessage = error.localizedDescription
            Haptics.error()
        }
    }

    private func toggleReaction(messageID: String, emoji: String, remove: Bool) async {
        guard let api = store.api else { return }
        Haptics.light()
        do {
            try await api.reactToMessage(id: messageID, emoji: emoji, remove: remove)
            await loadThread(silent: true)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func runEdit(_ message: BoardMessage, newText: String) async {
        guard let api = store.api, !newText.isEmpty else { return }
        do {
            try await api.editMessage(id: message.id, text: newText)
            Haptics.success()
            await loadThread(silent: true)
        } catch {
            errorMessage = error.localizedDescription
            Haptics.error()
        }
    }

    private func runDelete(_ message: BoardMessage) async {
        guard let api = store.api else { return }
        do {
            try await api.deleteMessage(id: message.id)
            Haptics.medium()
            await loadThread(silent: true)
        } catch {
            errorMessage = error.localizedDescription
            Haptics.error()
        }
    }

    private func runClaim(id: String) async {
        guard let api = store.api else { return }
        activeTaskAction = true
        defer { activeTaskAction = false }
        do {
            let res = try await api.claimTask(id: id)
            store.recordClaim(taskID: id, claim: res.claim)
            store.updateTaskFromMutation(res.task)
            Haptics.success()
            await loadThread(silent: true)
        } catch {
            errorMessage = error.localizedDescription
            Haptics.error()
        }
    }

    private func runRelease(id: String, claim: LocalTaskClaim) async {
        guard let api = store.api else { return }
        activeTaskAction = true
        defer { activeTaskAction = false }
        do {
            let res = try await api.releaseTask(id: id, epoch: claim.epoch, token: claim.token)
            store.recordClaim(taskID: id, claim: nil)
            store.updateTaskFromMutation(res.task)
            Haptics.medium()
            await loadThread(silent: true)
        } catch {
            errorMessage = error.localizedDescription
            Haptics.error()
        }
    }

    private func runUnblock(id: String) async {
        guard let api = store.api else { return }
        activeTaskAction = true
        defer { activeTaskAction = false }
        do {
            let res = try await api.unblockTask(id: id)
            store.updateTaskFromMutation(res.task)
            Haptics.success()
            await loadThread(silent: true)
        } catch {
            errorMessage = error.localizedDescription
            Haptics.error()
        }
    }

    private func runPromptedAction(_ kind: TaskPromptKind, input: String) async {
        guard let api = store.api, let message = detail?.message else { return }
        activeTaskAction = true
        defer { activeTaskAction = false }
        do {
            let res: TaskMutationResponse
            switch kind {
            case .complete:
                guard let claim = store.activeLocalClaim(for: message) else { return }
                res = try await api.completeTask(id: message.id, epoch: claim.epoch, token: claim.token, result: input.isEmpty ? nil : input)
                store.recordClaim(taskID: message.id, claim: nil)
            case .fail:
                guard let claim = store.activeLocalClaim(for: message) else { return }
                res = try await api.failTask(id: message.id, epoch: claim.epoch, token: claim.token, reason: input)
                store.recordClaim(taskID: message.id, claim: nil)
            case .hold:
                let claim = store.activeLocalClaim(for: message)
                res = try await api.blockTask(id: message.id, reason: input, claim: claim)
                store.recordClaim(taskID: message.id, claim: nil)
            case .cancel:
                res = try await api.cancelTask(id: message.id, reason: input)
                store.recordClaim(taskID: message.id, claim: nil)
            }
            store.updateTaskFromMutation(res.task)
            Haptics.success()
            await loadThread(silent: true)
        } catch {
            errorMessage = error.localizedDescription
            Haptics.error()
        }
    }
}
