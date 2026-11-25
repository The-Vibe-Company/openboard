import SwiftUI

struct TasksTabView: View {
    @Environment(BoardStore.self) private var store

    @State private var stateFilter: BoardTaskFilter = .open
    @State private var channelFilter: String?
    @State private var searchText = ""
    @State private var doneLimit = 8
    @State private var loadingOlder = false

    @State private var showNewTask = false
    @State private var newTaskChannel = ""
    @State private var newTaskText = ""
    @State private var creatingTask = false
    @State private var createError: String?

    private var filteredTasks: [ThreadSummary] {
        let base = store.sortedBoardTasks(channel: channelFilter, stateFilter: stateFilter)
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return base }
        return base.filter {
            $0.message.text.localizedCaseInsensitiveContains(q) ||
            $0.message.id.localizedCaseInsensitiveContains(q) ||
            $0.message.channel.localizedCaseInsensitiveContains(q) ||
            $0.message.labels.contains { "\($0.key)=\($0.value)".localizedCaseInsensitiveContains(q) }
        }
    }

    private var visibleTasks: [ThreadSummary] {
        if stateFilter == .done {
            return Array(filteredTasks.prefix(doneLimit))
        }
        return filteredTasks
    }

    private var remainingDone: Int {
        stateFilter == .done ? max(0, filteredTasks.count - visibleTasks.count) : 0
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                filterBar

                ScrollView {
                    LazyVStack(spacing: 0) {
                        if visibleTasks.isEmpty {
                            emptyState
                        } else {
                            tasksCard
                                .padding(.horizontal, 12)
                                .padding(.top, 12)
                        }

                        if store.boardTasksNextCursor != nil {
                            Button {
                                Task { await loadOlder() }
                            } label: {
                                HStack(spacing: 8) {
                                    if loadingOlder { ProgressView().controlSize(.small) }
                                    Text(loadingOlder ? "Loading older tasks…" : "Load older tasks")
                                        .font(.footnote.weight(.medium))
                                }
                                .foregroundStyle(OBTheme.muted)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 9)
                                .background(OBTheme.surface)
                                .overlay(
                                    Capsule().stroke(OBTheme.hairline, lineWidth: 1)
                                )
                                .clipShape(Capsule())
                            }
                            .buttonStyle(.plain)
                            .disabled(loadingOlder)
                            .padding(.top, 14)
                        }
                    }
                    .padding(.bottom, 20)
                }
                .background(OBTheme.background)
                .refreshable {
                    await store.refreshAll()
                }
            }
            .background(OBTheme.background)
            .navigationTitle("Tasks")
            .searchable(text: $searchText, prompt: "Search tasks or #id")
            .navigationDestination(for: ThreadRoute.self) { route in
                ThreadDetailView(threadID: route.id)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    channelPicker
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        newTaskChannel = channelFilter ?? store.channels.first?.path ?? "openboard"
                        showNewTask = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("New task")
                }
            }
            .sheet(isPresented: $showNewTask) {
                newTaskSheet
            }
        }
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(BoardTaskFilter.allCases) { filter in
                    let active = stateFilter == filter
                    let count = store.sortedBoardTasks(channel: channelFilter, stateFilter: filter).count
                    Button {
                        withAnimation(.easeInOut(duration: 0.15)) {
                            stateFilter = filter
                            if filter == .done { doneLimit = 8 }
                        }
                        Haptics.light()
                    } label: {
                        HStack(spacing: 5) {
                            Text(filter.rawValue)
                            Text("\(count)")
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(active ? OBTheme.background.opacity(0.8) : OBTheme.faint)
                        }
                        .font(.system(size: 12, weight: active ? .semibold : .medium))
                        .foregroundStyle(active ? OBTheme.background : OBTheme.muted)
                        .padding(.horizontal, 11)
                        .padding(.vertical, 6)
                        .background(active ? OBTheme.text : OBTheme.surface)
                        .overlay(
                            Capsule().stroke(active ? .clear : OBTheme.hairline, lineWidth: 1)
                        )
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
        }
        .background(OBTheme.background)
        .overlay(alignment: .bottom) {
            Rectangle().fill(OBTheme.hairline).frame(height: 0.75)
        }
    }

    private var channelPicker: some View {
        Menu {
            Button {
                channelFilter = nil
            } label: {
                Label("All channels", systemImage: channelFilter == nil ? "checkmark" : "")
            }
            Divider()
            ForEach(store.channels) { ch in
                Button {
                    channelFilter = ch.path
                } label: {
                    Label("#\(ch.path)", systemImage: channelFilter == ch.path ? "checkmark" : "")
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(channelFilter.map { "#\($0)" } ?? "All channels")
                    .font(.system(size: 13, weight: .medium, design: .monospaced))
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .semibold))
            }
            .foregroundStyle(OBTheme.muted)
        }
    }

    private var tasksCard: some View {
        VStack(spacing: 0) {
            HStack {
                Text("\(stateFilter.rawValue) · \(filteredTasks.count)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OBTheme.muted)
                Spacer()
                if stateFilter == .done {
                    Text("newest first")
                        .font(.caption2.monospaced())
                        .foregroundStyle(OBTheme.faint)
                } else {
                    LiveStatusBadge(state: store.liveState)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)

            ForEach(visibleTasks) { item in
                Rectangle().fill(OBTheme.hairline).frame(height: 0.75)
                NavigationLink(value: ThreadRoute(id: item.id)) {
                    TaskRowView(
                        summary: item,
                        holderName: item.message.task?.claim.map { store.actorDisplayName(for: $0.actor) },
                        showChannel: channelFilter == nil
                    )
                }
                .buttonStyle(.plain)
            }

            if stateFilter == .done && (remainingDone > 0 || doneLimit > 8) {
                Rectangle().fill(OBTheme.hairline).frame(height: 0.75)
                HStack {
                    if remainingDone > 0 {
                        Button {
                            doneLimit += 15
                            Haptics.light()
                        } label: {
                            Text("Show more (\(remainingDone) remaining)")
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
                .padding(.vertical, 10)
            }
        }
        .background(OBTheme.surface)
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(OBTheme.hairline, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "checklist")
                .font(.title2)
                .foregroundStyle(OBTheme.faint)
            Text(searchText.isEmpty ? "No \(stateFilter.rawValue.lowercased()) tasks" : "No matching tasks")
                .font(.subheadline)
                .foregroundStyle(OBTheme.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 56)
    }

    private var newTaskSheet: some View {
        NavigationStack {
            Form {
                Section("Channel") {
                    if store.channels.isEmpty {
                        TextField("Channel path", text: $newTaskChannel)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .font(.body.monospaced())
                    } else {
                        Picker("Channel", selection: $newTaskChannel) {
                            ForEach(store.channels) { ch in
                                Text("#\(ch.path)").tag(ch.path)
                            }
                        }
                    }
                }

                Section("Task") {
                    TextField("What needs to be done?", text: $newTaskText, axis: .vertical)
                        .lineLimit(3...8)
                }

                if let createError {
                    Section {
                        Text(createError)
                            .font(.footnote)
                            .foregroundStyle(OBTheme.danger)
                    }
                }
            }
            .navigationTitle("New Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        showNewTask = false
                        createError = nil
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(creatingTask ? "Creating…" : "Create") {
                        Task { await submitNewTask() }
                    }
                    .disabled(
                        newTaskText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                        newTaskChannel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                        creatingTask
                    )
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func loadOlder() async {
        loadingOlder = true
        defer { loadingOlder = false }
        await store.loadOlderBoardTasks()
    }

    private func submitNewTask() async {
        let trimmed = newTaskText.trimmingCharacters(in: .whitespacesAndNewlines)
        let ch = newTaskChannel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !ch.isEmpty else { return }
        creatingTask = true
        createError = nil
        defer { creatingTask = false }
        do {
            _ = try await store.createTask(channel: ch, text: trimmed)
            newTaskText = ""
            showNewTask = false
            Haptics.success()
        } catch {
            createError = error.localizedDescription
            Haptics.error()
        }
    }
}
