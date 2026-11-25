import SwiftUI

enum ChannelSubView: String, CaseIterable, Identifiable {
    case all = "All"
    case messages = "Messages"
    case tasks = "Tasks"
    case activity = "Activity"

    var id: String { rawValue }
}

enum ChannelTaskSubFilter: String, CaseIterable, Identifiable {
    case open = "Open"
    case done = "Done"
    case all = "All"

    var id: String { rawValue }
}

struct ChannelDetailView: View {
    @Environment(BoardStore.self) private var store

    let channel: String

    @State private var selectedView: ChannelSubView = .all
    @State private var taskFilter: ChannelTaskSubFilter = .open
    @State private var activityCategory: BoardEvent.Category = .all
    @State private var searchText = ""
    @State private var doneLimit = 8

    @State private var composerMode: ComposerMode = .message
    @State private var composerText = ""
    @State private var isSending = false
    @State private var sendError: String?

    private var openTasks: [ThreadSummary] { store.openTasks(in: channel, search: searchText) }
    private var doneTasks: [ThreadSummary] { store.doneTasks(in: channel, search: searchText) }
    private var pureMessages: [ThreadSummary] { store.pureMessages(in: channel, search: searchText) }
    private var channelEvents: [BoardEvent] {
        store.channelEvents(channel).filter { activityCategory == .all || $0.category == activityCategory }
    }

    var body: some View {
        VStack(spacing: 0) {
            subTabsBar

            ScrollView {
                LazyVStack(spacing: 0) {
                    if let sendError {
                        Text(sendError)
                            .font(.footnote)
                            .foregroundStyle(OBTheme.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                    }

                    switch selectedView {
                    case .all:
                        allContent
                    case .messages:
                        messagesSection(showHeader: false)
                    case .tasks:
                        tasksWorkspace
                    case .activity:
                        activityWorkspace
                    }
                }
                .padding(.bottom, 16)
            }
            .background(OBTheme.background)
            .refreshable {
                await store.refreshChannel(channel)
            }

            if selectedView != .activity {
                ComposerBarView(
                    allowTask: true,
                    mode: $composerMode,
                    text: $composerText,
                    placeholder: composerMode == .task ? "Describe a task in #\(channel)…" : "Message #\(channel)…",
                    isSending: isSending,
                    onSend: { Task { await submitComposer() } }
                )
            }
        }
        .background(OBTheme.background)
        .navigationTitle("#\(channel)")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $searchText, prompt: "Search #\(channel)")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                LiveStatusBadge(state: store.liveState)
            }
        }
        .task {
            await store.refreshChannel(channel)
        }
        .onChange(of: selectedView) { _, next in
            if next == .tasks { composerMode = .task }
            if next == .messages { composerMode = .message }
        }
    }

    private var subTabsBar: some View {
        HStack(spacing: 0) {
            ForEach(ChannelSubView.allCases) { tab in
                let isActive = selectedView == tab
                Button {
                    withAnimation(.easeInOut(duration: 0.16)) {
                        selectedView = tab
                    }
                    Haptics.light()
                } label: {
                    VStack(spacing: 0) {
                        HStack(spacing: 5) {
                            Text(tab.rawValue)
                                .font(.system(size: 13, weight: isActive ? .semibold : .medium))
                                .foregroundStyle(isActive ? OBTheme.text : OBTheme.muted)
                            if tab == .tasks && !openTasks.isEmpty {
                                Text("\(openTasks.count)")
                                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                                    .foregroundStyle(OBTheme.muted)
                                    .padding(.horizontal, 5)
                                    .padding(.vertical, 1)
                                    .background(OBTheme.shade)
                                    .clipShape(Capsule())
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)

                        Rectangle()
                            .fill(isActive ? OBTheme.text : .clear)
                            .frame(height: 2)
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .background(OBTheme.background)
        .overlay(alignment: .bottom) {
            Rectangle().fill(OBTheme.hairline).frame(height: 0.75)
        }
    }

    @ViewBuilder
    private var allContent: some View {
        if !openTasks.isEmpty || !doneTasks.isEmpty {
            openTasksCard(showHistoryFooter: true)
                .padding(.horizontal, 12)
                .padding(.top, 12)
        }
        messagesSection(showHeader: !openTasks.isEmpty || !doneTasks.isEmpty)
    }

    private func openTasksCard(showHistoryFooter: Bool) -> some View {
        VStack(spacing: 0) {
            HStack {
                HStack(spacing: 6) {
                    Text("Open tasks")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(OBTheme.muted)
                    Text("\(openTasks.count)")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(OBTheme.muted)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(OBTheme.shade)
                        .clipShape(Capsule())
                }
                Spacer()
                if showHistoryFooter {
                    Button {
                        selectedView = .tasks
                        taskFilter = .open
                    } label: {
                        Text("Manage →")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(OBTheme.muted)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)

            if openTasks.isEmpty {
                Text("No open tasks in #\(channel)")
                    .font(.caption)
                    .foregroundStyle(OBTheme.faint)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 10)
            } else {
                ForEach(openTasks) { item in
                    Rectangle().fill(OBTheme.hairline).frame(height: 0.75)
                    NavigationLink(value: ThreadRoute(id: item.id)) {
                        TaskRowView(
                            summary: item,
                            holderName: item.message.task?.claim.map { store.actorDisplayName(for: $0.actor) }
                        )
                    }
                    .buttonStyle(.plain)
                }
            }

            if showHistoryFooter && !doneTasks.isEmpty {
                Rectangle().fill(OBTheme.hairline).frame(height: 0.75)
                Button {
                    selectedView = .tasks
                    taskFilter = .done
                    Haptics.light()
                } label: {
                    HStack {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.caption)
                            .foregroundStyle(OBTheme.success)
                        Text("\(doneTasks.count) completed in #\(channel)")
                            .font(.caption)
                            .foregroundStyle(OBTheme.muted)
                        Spacer()
                        Text("View history →")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(OBTheme.muted)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                }
                .buttonStyle(.plain)
            }
        }
        .background(OBTheme.surface)
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(OBTheme.hairline, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    @ViewBuilder
    private func messagesSection(showHeader: Bool) -> some View {
        if showHeader {
            Text("MESSAGES")
                .font(.system(size: 11, weight: .semibold))
                .tracking(0.7)
                .foregroundStyle(OBTheme.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.top, 16)
                .padding(.bottom, 6)
        }

        if pureMessages.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "bubble.left.and.bubble.right")
                    .font(.title2)
                    .foregroundStyle(OBTheme.faint)
                Text(searchText.isEmpty ? "No messages in #\(channel) yet" : "No matching messages")
                    .font(.subheadline)
                    .foregroundStyle(OBTheme.muted)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 44)
        } else {
            ForEach(pureMessages) { thread in
                NavigationLink(value: ThreadRoute(id: thread.id)) {
                    ThreadRowView(summary: thread)
                }
                .buttonStyle(.plain)
                Rectangle()
                    .fill(OBTheme.hairline)
                    .frame(height: 0.75)
                    .padding(.leading, 57)
            }
        }
    }

    @ViewBuilder
    private var tasksWorkspace: some View {
        HStack(spacing: 6) {
            ForEach(ChannelTaskSubFilter.allCases) { pill in
                let active = taskFilter == pill
                Button {
                    taskFilter = pill
                    Haptics.light()
                } label: {
                    HStack(spacing: 4) {
                        Text(pill.rawValue)
                        Text("\(countFor(pill))")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(OBTheme.faint)
                    }
                    .font(.system(size: 12, weight: active ? .semibold : .medium))
                    .foregroundStyle(active ? OBTheme.text : OBTheme.muted)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 6)
                    .background(active ? OBTheme.shade : .clear)
                    .overlay(
                        Capsule().stroke(active ? OBTheme.hairline : .clear, lineWidth: 1)
                    )
                    .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)

        if taskFilter != .done {
            openTasksCard(showHistoryFooter: false)
                .padding(.horizontal, 12)
                .padding(.bottom, 10)
        }

        if taskFilter != .open {
            doneTasksCard
                .padding(.horizontal, 12)
        }
    }

    private var doneTasksCard: some View {
        let visible = Array(doneTasks.prefix(doneLimit))
        let remaining = max(0, doneTasks.count - visible.count)
        return VStack(spacing: 0) {
            HStack(spacing: 6) {
                Text("Completed tasks")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OBTheme.muted)
                Text("\(doneTasks.count)")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(OBTheme.muted)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(OBTheme.shade)
                    .clipShape(Capsule())
                Spacer()
                Text("newest first")
                    .font(.caption2.monospaced())
                    .foregroundStyle(OBTheme.faint)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)

            if visible.isEmpty {
                Text("No completed tasks yet")
                    .font(.caption)
                    .foregroundStyle(OBTheme.faint)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 10)
            } else {
                ForEach(visible) { item in
                    Rectangle().fill(OBTheme.hairline).frame(height: 0.75)
                    NavigationLink(value: ThreadRoute(id: item.id)) {
                        TaskRowView(summary: item, holderName: nil)
                    }
                    .buttonStyle(.plain)
                }

                if remaining > 0 || doneLimit > 8 {
                    Rectangle().fill(OBTheme.hairline).frame(height: 0.75)
                    HStack {
                        if remaining > 0 {
                            Button {
                                doneLimit += 15
                                Haptics.light()
                            } label: {
                                Text("Show more (\(remaining) remaining)")
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(OBTheme.muted)
                            }
                            .buttonStyle(.plain)
                        }
                        Spacer()
                        if doneLimit > 8 {
                            Button {
                                doneLimit = 8
                                Haptics.light()
                            } label: {
                                Text("Show less")
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(OBTheme.muted)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                }
            }
        }
        .background(OBTheme.surface)
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(OBTheme.hairline, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    @ViewBuilder
    private var activityWorkspace: some View {
        HStack(spacing: 6) {
            ForEach(BoardEvent.Category.allCases) { cat in
                let active = activityCategory == cat
                Button {
                    activityCategory = cat
                    Haptics.light()
                } label: {
                    Text(cat.rawValue)
                        .font(.system(size: 12, weight: active ? .semibold : .medium))
                        .foregroundStyle(active ? OBTheme.text : OBTheme.muted)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(active ? OBTheme.shade : .clear)
                        .overlay(Capsule().stroke(active ? OBTheme.hairline : .clear, lineWidth: 1))
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
            Spacer()
            Button {
                store.activityPaused.toggle()
                Haptics.light()
            } label: {
                Image(systemName: store.activityPaused ? "play.fill" : "pause.fill")
                    .font(.caption)
                    .foregroundStyle(OBTheme.muted)
                    .padding(7)
                    .background(OBTheme.shade)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(store.activityPaused ? "Resume stream" : "Pause stream")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)

        if channelEvents.isEmpty {
            Text("No activity recorded in #\(channel) yet.")
                .font(.subheadline)
                .foregroundStyle(OBTheme.muted)
                .padding(.vertical, 40)
        } else {
            ForEach(channelEvents) { event in
                if let tid = event.threadID {
                    NavigationLink(value: ThreadRoute(id: tid)) {
                        ActivityRowView(event: event)
                    }
                    .buttonStyle(.plain)
                } else {
                    ActivityRowView(event: event)
                }
                Rectangle()
                    .fill(OBTheme.hairline)
                    .frame(height: 0.75)
                    .padding(.leading, 52)
            }
        }
    }

    private func countFor(_ pill: ChannelTaskSubFilter) -> Int {
        switch pill {
        case .open: openTasks.count
        case .done: doneTasks.count
        case .all: openTasks.count + doneTasks.count
        }
    }

    private func submitComposer() async {
        let trimmed = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSending else { return }
        isSending = true
        sendError = nil
        defer { isSending = false }
        do {
            if composerMode == .task {
                _ = try await store.createTask(channel: channel, text: trimmed)
                if selectedView == .messages { selectedView = .tasks }
            } else {
                _ = try await store.postMessage(channel: channel, text: trimmed)
                if selectedView == .tasks { selectedView = .all }
            }
            composerText = ""
            Haptics.success()
        } catch {
            sendError = error.localizedDescription
            Haptics.error()
        }
    }
}
