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

    var body: some View {
        let openTasks = store.openTasks(in: channel, search: searchText)
        let doneTasks = selectedView == .all || selectedView == .tasks
            ? store.doneTasks(in: channel, search: searchText) : []
        let hasTasks = !openTasks.isEmpty || !doneTasks.isEmpty
        VStack(spacing: 0) {
            subTabsBar(openCount: openTasks.count)
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
                        if hasTasks {
                            taskCard(openTasks, completed: false, historyCount: doneTasks.count)
                                .padding(.top, 12)
                        }
                        messagesSection(showHeader: hasTasks)
                    case .messages:
                        messagesSection(showHeader: false)
                    case .tasks:
                        tasksWorkspace(openTasks: openTasks, doneTasks: doneTasks)
                    case .activity:
                        activityWorkspace
                    }
                }
                .padding(.bottom, 16)
            }
            .background(OBTheme.background)
            .refreshable { await store.refreshChannel(channel) }

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
        .task { await store.refreshChannel(channel) }
        .onChange(of: selectedView) { _, next in
            if next == .tasks { composerMode = .task }
            if next == .messages { composerMode = .message }
        }
    }

    private func subTabsBar(openCount: Int) -> some View {
        HStack(spacing: 0) {
            ForEach(ChannelSubView.allCases) { tab in
                let isActive = selectedView == tab
                Button {
                    withAnimation(.easeInOut(duration: 0.16)) { selectedView = tab }
                    Haptics.light()
                } label: {
                    VStack(spacing: 0) {
                        HStack(spacing: 5) {
                            Text(tab.rawValue)
                                .font(.system(size: 13, weight: isActive ? .semibold : .medium))
                                .foregroundStyle(isActive ? OBTheme.text : OBTheme.muted)
                            if tab == .tasks && openCount > 0 {
                                Text("\(openCount)")
                                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                                    .foregroundStyle(OBTheme.muted)
                                    .padding(.horizontal, 5)
                                    .padding(.vertical, 1)
                                    .background(OBTheme.shade, in: Capsule())
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        Rectangle().fill(isActive ? OBTheme.text : .clear).frame(height: 2)
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

    private func taskCard(_ tasks: [ThreadSummary], completed: Bool, historyCount: Int? = nil) -> some View {
        let visible = tasks.prefix(completed ? doneLimit : tasks.count)
        return LazyVStack(spacing: 0) {
            taskCardHeader(count: tasks.count, completed: completed, showsManage: historyCount != nil)
            if tasks.isEmpty {
                Text(completed ? "No completed tasks yet" : "No open tasks in #\(channel)")
                    .font(.caption)
                    .foregroundStyle(OBTheme.faint)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 10)
            }
            ForEach(visible) { item in
                NavigationLink(value: ThreadRoute(id: item.id)) {
                    TaskRowView(
                        summary: item,
                        holderName: completed ? nil : item.message.task?.claim.map { store.actorDisplayName(for: $0.actor) }
                    )
                }
                .buttonStyle(.plain)
                .overlay(alignment: .top) { rowSeparator(leading: 0) }
            }
            if let historyCount, historyCount > 0 {
                historyFooter(count: historyCount)
            }
            if completed && !tasks.isEmpty {
                completedFooter(remaining: tasks.count - visible.count)
            }
        }
        .background(OBTheme.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(OBTheme.hairline))
        .padding(.horizontal, 12)
    }

    private func taskCardHeader(count: Int, completed: Bool, showsManage: Bool) -> some View {
        HStack(spacing: 6) {
            Text(completed ? "Completed tasks" : "Open tasks")
                .font(.system(size: 12, weight: .semibold))
            Text("\(count)")
                .font(.system(size: 11, design: .monospaced))
                .padding(.horizontal, 6)
                .padding(.vertical, 1)
                .background(OBTheme.shade, in: Capsule())
            Spacer()
            if completed {
                Text("newest first").font(.caption2.monospaced()).foregroundStyle(OBTheme.faint)
            }
            if showsManage {
                taskCardButton("Manage →") {
                    selectedView = .tasks
                    taskFilter = .open
                }
            }
        }
        .foregroundStyle(OBTheme.muted)
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
    }

    @ViewBuilder
    private func historyFooter(count: Int) -> some View {
        Divider()
        Button {
            selectedView = .tasks
            taskFilter = .done
            Haptics.light()
        } label: {
            HStack {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(OBTheme.success)
                Text("\(count) completed in #\(channel)")
                Spacer()
                Text("View history →").fontWeight(.medium)
            }
            .font(.caption)
            .foregroundStyle(OBTheme.muted)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func completedFooter(remaining: Int) -> some View {
        if remaining > 0 || doneLimit > 8 {
            Divider()
            HStack {
                if remaining > 0 {
                    taskCardButton("Show more (\(remaining) remaining)", haptic: true) { doneLimit += 15 }
                }
                Spacer()
                if doneLimit > 8 {
                    taskCardButton("Show less", haptic: true) { doneLimit = 8 }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
        }
    }

    private func taskCardButton(_ title: String, haptic: Bool = false, action: @escaping () -> Void) -> some View {
        Button {
            action()
            if haptic { Haptics.light() }
        } label: {
            Text(title).font(.caption.weight(.medium)).foregroundStyle(OBTheme.muted)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func messagesSection(showHeader: Bool) -> some View {
        let pureMessages = store.pureMessages(in: channel, search: searchText)
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
                rowSeparator(leading: 57)
            }
        }
    }

    @ViewBuilder
    private func tasksWorkspace(openTasks: [ThreadSummary], doneTasks: [ThreadSummary]) -> some View {
        let counts = [openTasks.count, doneTasks.count, openTasks.count + doneTasks.count]
        HStack(spacing: 6) {
            ForEach(Array(zip(ChannelTaskSubFilter.allCases, counts)), id: \.0) { pill, count in
                let active = taskFilter == pill
                filterPill(active: active, action: { taskFilter = pill }) {
                    HStack(spacing: 4) {
                        Text(pill.rawValue)
                        Text("\(count)")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(OBTheme.faint)
                    }
                }
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        if taskFilter != .done {
            taskCard(openTasks, completed: false).padding(.bottom, 10)
        }
        if taskFilter != .open { taskCard(doneTasks, completed: true) }
    }

    @ViewBuilder
    private var activityWorkspace: some View {
        HStack(spacing: 6) {
            ForEach(BoardEvent.Category.allCases) { cat in
                filterPill(active: activityCategory == cat, action: { activityCategory = cat }) {
                    Text(cat.rawValue)
                }
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
                    .background(OBTheme.shade, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(store.activityPaused ? "Resume stream" : "Pause stream")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        let channelEvents = store.channelEvents(channel).filter {
            activityCategory == .all || $0.category == activityCategory
        }
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
                rowSeparator(leading: 52)
            }
        }
    }

    private func filterPill<Label: View>(
        active: Bool, action: @escaping () -> Void, @ViewBuilder label: () -> Label
    ) -> some View {
        Button {
            action()
            Haptics.light()
        } label: {
            label()
                .font(.system(size: 12, weight: active ? .semibold : .medium))
                .foregroundStyle(active ? OBTheme.text : OBTheme.muted)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(active ? OBTheme.shade : .clear, in: Capsule())
                .overlay(Capsule().strokeBorder(active ? OBTheme.hairline : .clear))
        }
        .buttonStyle(.plain)
    }

    private func rowSeparator(leading: CGFloat) -> some View {
        Rectangle().fill(OBTheme.hairline).frame(height: 0.75).padding(.leading, leading)
    }

    private func submitComposer() async {
        let trimmed = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSending else { return }
        let generation = store.generation
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
            guard store.shouldPresent(error, generation: generation) else { return }
            sendError = error.localizedDescription
            Haptics.error()
        }
    }
}
