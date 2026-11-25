import SwiftUI

struct ChannelsTabView: View {
    @Environment(BoardStore.self) private var store
    @State private var searchText = ""
    @State private var showNewChannel = false
    @State private var newChannelPath = ""
    @State private var creating = false
    @State private var createError: String?

    private var filteredChannels: [ChannelInfo] {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return store.channels }
        return store.channels.filter { $0.path.localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                OBTheme.background.ignoresSafeArea()
                if store.isBootstrapping && store.channels.isEmpty {
                    ProgressView("Loading board…")
                        .foregroundStyle(OBTheme.muted)
                } else {
                    List {
                        if let banner = store.errorBanner {
                            Section {
                                Text(banner)
                                    .font(.footnote)
                                    .foregroundStyle(OBTheme.danger)
                            }
                            .listRowBackground(OBTheme.surface)
                        }

                        Section {
                            ForEach(filteredChannels) { channel in
                                NavigationLink(value: channel.path) {
                                    channelRow(channel)
                                }
                                .listRowBackground(OBTheme.surface)
                                .listRowSeparatorTint(OBTheme.hairline)
                            }
                        } header: {
                            HStack {
                                Text("CHANNELS")
                                    .font(.caption.weight(.semibold))
                                    .tracking(0.7)
                                    .foregroundStyle(OBTheme.muted)
                                Spacer()
                                LiveStatusBadge(state: store.liveState)
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                    .scrollContentBackground(.hidden)
                    .refreshable {
                        await store.refreshAll()
                    }
                }
            }
            .navigationTitle(boardTitle)
            .searchable(text: $searchText, prompt: "Filter channels")
            .navigationDestination(for: String.self) { channelPath in
                ChannelDetailView(channel: channelPath)
            }
            .navigationDestination(for: ThreadRoute.self) { route in
                ThreadDetailView(threadID: route.id)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showNewChannel = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("New channel")
                }
            }
            .sheet(isPresented: $showNewChannel) {
                NavigationStack {
                    Form {
                        Section("Channel path") {
                            TextField("e.g. openboard or work/mobile", text: $newChannelPath)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .font(.body.monospaced())
                        }
                        if let createError {
                            Section {
                                Text(createError)
                                    .font(.footnote)
                                    .foregroundStyle(OBTheme.danger)
                            }
                        }
                    }
                    .navigationTitle("New Channel")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cancel") {
                                showNewChannel = false
                                createError = nil
                            }
                        }
                        ToolbarItem(placement: .confirmationAction) {
                            Button(creating ? "Creating…" : "Create") {
                                Task { await submitNewChannel() }
                            }
                            .disabled(newChannelPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || creating)
                        }
                    }
                }
                .presentationDetents([.medium])
            }
        }
    }

    private var boardTitle: String {
        if let s = store.session {
            return "\(s.org) / \(s.board)"
        }
        return "OpenBoard"
    }

    private func channelRow(_ channel: ChannelInfo) -> some View {
        let openCount = store.openTasks(in: channel.path).count
        return HStack(spacing: 10) {
            Text("#")
                .font(.system(size: 16, weight: .semibold, design: .monospaced))
                .foregroundStyle(OBTheme.faint)

            VStack(alignment: .leading, spacing: 2) {
                Text(channel.path)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(OBTheme.text)
                if let threads = channel.threads, let messages = channel.messages {
                    Text("\(threads) threads · \(messages) messages")
                        .font(.caption.monospaced())
                        .foregroundStyle(OBTheme.muted)
                }
            }

            Spacer()

            if openCount > 0 {
                Text("\(openCount) open")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(OBTheme.accent)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(OBTheme.accent.opacity(0.13))
                    .clipShape(Capsule())
            }
        }
        .padding(.vertical, 4)
    }

    private func submitNewChannel() async {
        creating = true
        createError = nil
        defer { creating = false }
        do {
            _ = try await store.createChannel(path: newChannelPath)
            newChannelPath = ""
            showNewChannel = false
            Haptics.success()
        } catch {
            createError = error.localizedDescription
            Haptics.error()
        }
    }
}

struct ThreadRoute: Hashable {
    let id: String
}
