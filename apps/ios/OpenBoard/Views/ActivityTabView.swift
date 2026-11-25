import SwiftUI

struct ActivityTabView: View {
    @Environment(BoardStore.self) private var store

    @State private var category: BoardEvent.Category = .all
    @State private var searchText = ""

    private var filteredEvents: [BoardEvent] {
        let byCat = store.events.filter { category == .all || $0.category == category }
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return byCat }
        return byCat.filter {
            $0.summaryText.localizedCaseInsensitiveContains(q) ||
            $0.actorName.localizedCaseInsensitiveContains(q) ||
            $0.type.localizedCaseInsensitiveContains(q) ||
            ($0.channelPath?.localizedCaseInsensitiveContains(q) ?? false)
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                categoryBar

                ScrollView {
                    LazyVStack(spacing: 0) {
                        if filteredEvents.isEmpty {
                            VStack(spacing: 8) {
                                Image(systemName: "waveform.path.ecg")
                                    .font(.title2)
                                    .foregroundStyle(OBTheme.faint)
                                Text(searchText.isEmpty ? "No board events yet" : "No matching events")
                                    .font(.subheadline)
                                    .foregroundStyle(OBTheme.muted)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 56)
                        } else {
                            ForEach(filteredEvents) { event in
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
                    .padding(.bottom, 16)
                }
                .background(OBTheme.background)
                .refreshable {
                    await store.refreshAll()
                }
            }
            .background(OBTheme.background)
            .navigationTitle("Activity")
            .searchable(text: $searchText, prompt: "Filter events")
            .navigationDestination(for: ThreadRoute.self) { route in
                ThreadDetailView(threadID: route.id)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    LiveStatusBadge(state: store.liveState)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        store.activityPaused.toggle()
                        Haptics.light()
                    } label: {
                        Label(
                            store.activityPaused ? "Resume" : "Pause",
                            systemImage: store.activityPaused ? "play.fill" : "pause.fill"
                        )
                    }
                    .accessibilityLabel(store.activityPaused ? "Resume live activity" : "Pause live activity")
                }
            }
        }
    }

    private var categoryBar: some View {
        HStack(spacing: 6) {
            ForEach(BoardEvent.Category.allCases) { cat in
                let active = category == cat
                Button {
                    category = cat
                    Haptics.light()
                } label: {
                    Text(cat.rawValue)
                        .font(.system(size: 12, weight: active ? .semibold : .medium))
                        .foregroundStyle(active ? OBTheme.background : OBTheme.muted)
                        .padding(.horizontal, 11)
                        .padding(.vertical, 6)
                        .background(active ? OBTheme.text : OBTheme.surface)
                        .overlay(Capsule().stroke(active ? .clear : OBTheme.hairline, lineWidth: 1))
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
            Spacer()
            if store.activityPaused {
                Text("PAUSED")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OBTheme.warning)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(OBTheme.background)
        .overlay(alignment: .bottom) {
            Rectangle().fill(OBTheme.hairline).frame(height: 0.75)
        }
    }
}
