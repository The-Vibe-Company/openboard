import SwiftUI

struct SettingsTabView: View {
    @Environment(BoardStore.self) private var store
    @State private var confirmSignOut = false

    private var appVersion: String {
        let short = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.4.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(short) (\(build))"
    }

    var body: some View {
        NavigationStack {
            List {
                if let me = store.me {
                    Section("Account") {
                        HStack(spacing: 12) {
                            AuthorAvatarView(name: me.name, avatarURL: me.avatar, size: 42)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(me.name)
                                    .font(.headline)
                                    .foregroundStyle(OBTheme.text)
                                Text("@\(me.handle) · \(me.kind.rawValue)")
                                    .font(.caption.monospaced())
                                    .foregroundStyle(OBTheme.muted)
                            }
                        }
                        .padding(.vertical, 4)
                        .listRowBackground(OBTheme.surface)
                    }
                }

                if let session = store.session {
                    Section("Workspace") {
                        LabeledContent("Server") {
                            Text(session.origin.replacingOccurrences(of: "https://", with: ""))
                                .font(.caption.monospaced())
                                .foregroundStyle(OBTheme.muted)
                        }
                        .listRowBackground(OBTheme.surface)

                        LabeledContent("Organization") {
                            Text(session.orgName ?? session.org)
                                .font(.callout)
                                .foregroundStyle(OBTheme.text)
                        }
                        .listRowBackground(OBTheme.surface)

                        if session.boards.count > 1 {
                            Picker("Board", selection: Binding(
                                get: { session.board },
                                set: { slug in
                                    Task { await store.switchBoard(slug: slug) }
                                }
                            )) {
                                ForEach(session.boards) { board in
                                    Text(board.name).tag(board.slug)
                                }
                            }
                            .listRowBackground(OBTheme.surface)
                        } else {
                            LabeledContent("Board") {
                                Text(session.board)
                                    .font(.callout.monospaced())
                                    .foregroundStyle(OBTheme.text)
                            }
                            .listRowBackground(OBTheme.surface)
                        }

                        HStack {
                            Text("Live stream")
                            Spacer()
                            LiveStatusBadge(state: store.liveState)
                        }
                        .listRowBackground(OBTheme.surface)

                        Button {
                            Task { await store.refreshAll() }
                            Haptics.light()
                        } label: {
                            Label("Reconnect & Refresh", systemImage: "arrow.clockwise")
                        }
                        .listRowBackground(OBTheme.surface)
                    }
                }

                Section("Appearance") {
                    Picker("Theme", selection: Bindable(store).appearance) {
                        ForEach(AppearancePreference.allCases) { pref in
                            Text(pref.label).tag(pref)
                        }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(OBTheme.surface)
                }

                Section("About") {
                    LabeledContent("Version", value: appVersion)
                        .font(.callout.monospaced())
                        .listRowBackground(OBTheme.surface)
                    LabeledContent("Bundle ID", value: "co.thevibecompany.openboard")
                        .font(.caption.monospaced())
                        .listRowBackground(OBTheme.surface)
                }

                Section {
                    Button(role: .destructive) {
                        confirmSignOut = true
                    } label: {
                        HStack {
                            Spacer()
                            Text("Sign Out")
                                .fontWeight(.semibold)
                            Spacer()
                        }
                    }
                    .listRowBackground(OBTheme.surface)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(OBTheme.background)
            .navigationTitle("Settings")
            .confirmationDialog("Sign out of OpenBoard?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign Out", role: .destructive) {
                    store.signOut()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Your token and local task leases will be cleared from Keychain.")
            }
        }
    }
}
