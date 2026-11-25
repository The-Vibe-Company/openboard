import SafariServices
import SwiftUI

struct SignInView: View {
    @Environment(BoardStore.self) private var store

    @State private var origin = SavedSession.productionOrigin
    @State private var showServerConfig = false
    @State private var showTokenSheet = false

    @State private var deviceFlow: DeviceStartResponse?
    @State private var safariURL: URL?
    @State private var isStarting = false
    @State private var copiedCode = false
    @State private var statusMessage: String?
    @State private var errorText: String?
    @State private var pollTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            ZStack {
                OBTheme.background.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 28) {
                        Spacer(minLength: 36)
                        brandHeader

                        if let flow = deviceFlow {
                            deviceApprovalCard(flow)
                        } else {
                            primaryActionsCard
                        }

                        serverDisclosure
                        Spacer(minLength: 24)
                    }
                    .padding(.horizontal, 22)
                }
            }
            .sheet(isPresented: Binding(
                get: { safariURL != nil },
                set: { if !$0 { safariURL = nil } }
            )) {
                if let url = safariURL {
                    SafariSheetView(url: url)
                        .ignoresSafeArea()
                }
            }
            .sheet(isPresented: $showTokenSheet) {
                TokenSignInSheet(origin: origin)
            }
            .onDisappear {
                pollTask?.cancel()
            }
        }
    }

    private var brandHeader: some View {
        VStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(OBTheme.surfaceRaised)
                    .frame(width: 72, height: 72)
                    .overlay(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .stroke(OBTheme.hairline, lineWidth: 1)
                    )
                HStack(spacing: 5) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(OBTheme.text)
                        .frame(width: 11, height: 36)
                    VStack(spacing: 5) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(OBTheme.text)
                            .frame(width: 24, height: 15)
                            .overlay(alignment: .topTrailing) {
                                Circle()
                                    .fill(OBTheme.success)
                                    .frame(width: 5, height: 5)
                                    .padding(3)
                            }
                        RoundedRectangle(cornerRadius: 3)
                            .fill(OBTheme.muted.opacity(0.45))
                            .frame(width: 24, height: 16)
                    }
                }
            }

            VStack(spacing: 6) {
                Text("OpenBoard")
                    .font(.system(size: 30, weight: .bold, design: .default))
                    .tracking(-0.8)
                    .foregroundStyle(OBTheme.text)
                Text("Live board & task queue for people and agents")
                    .font(.subheadline)
                    .foregroundStyle(OBTheme.muted)
                    .multilineTextAlignment(.center)
            }
        }
    }

    private var primaryActionsCard: some View {
        VStack(spacing: 12) {
            Button {
                Task { await startDeviceLogin() }
            } label: {
                HStack(spacing: 10) {
                    if isStarting {
                        ProgressView()
                            .tint(OBTheme.background)
                    } else {
                        Image(systemName: "person.badge.key.fill")
                    }
                    Text(isStarting ? "Connecting…" : "Sign in to OpenBoard")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(OBTheme.text)
                .foregroundStyle(OBTheme.background)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .disabled(isStarting)

            Button {
                showTokenSheet = true
            } label: {
                Text("Sign in with token")
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .foregroundStyle(OBTheme.text)
                    .background(OBTheme.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(OBTheme.hairline, lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }

            if let errorText {
                Text(errorText)
                    .font(.footnote)
                    .foregroundStyle(OBTheme.danger)
                    .multilineTextAlignment(.center)
                    .padding(.top, 4)
            }
        }
    }

    private func deviceApprovalCard(_ flow: DeviceStartResponse) -> some View {
        VStack(spacing: 16) {
            HStack {
                Text("APPROVE ON OPENBOARD")
                    .font(.caption.weight(.semibold))
                    .tracking(0.8)
                    .foregroundStyle(OBTheme.muted)
                Spacer()
                ProgressView()
                    .controlSize(.small)
            }

            Text(flow.userCode)
                .font(.system(size: 20, weight: .bold, design: .monospaced))
                .foregroundStyle(OBTheme.text)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity)
                .background(OBTheme.background)
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(OBTheme.hairline, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .onTapGesture {
                    copyCode(flow.userCode)
                }

            Text("Code copied. Tap below to sign in with GitHub and paste this code to connect your iPhone.")
                .font(.footnote)
                .foregroundStyle(OBTheme.muted)
                .multilineTextAlignment(.center)

            HStack(spacing: 10) {
                Button {
                    copyCode(flow.userCode)
                } label: {
                    Label(copiedCode ? "Copied" : "Copy code", systemImage: copiedCode ? "checkmark" : "doc.on.doc")
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(OBTheme.surfaceRaised)
                        .foregroundStyle(OBTheme.text)
                        .overlay(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .stroke(OBTheme.hairline, lineWidth: 1)
                        )
                }

                Button {
                    if let url = URL(string: flow.verificationUri) {
                        safariURL = url
                    }
                } label: {
                    Label("Open browser", systemImage: "safari")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(OBTheme.text)
                        .foregroundStyle(OBTheme.background)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
            }

            if let statusMessage {
                Text(statusMessage)
                    .font(.caption)
                    .foregroundStyle(OBTheme.muted)
            }

            if let errorText {
                Text(errorText)
                    .font(.caption)
                    .foregroundStyle(OBTheme.danger)
            }

            Button("Cancel") {
                pollTask?.cancel()
                deviceFlow = nil
                statusMessage = nil
                errorText = nil
            }
            .font(.footnote)
            .foregroundStyle(OBTheme.muted)
        }
        .padding(18)
        .background(OBTheme.surface)
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(OBTheme.hairline, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var serverDisclosure: some View {
        VStack(spacing: 10) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    showServerConfig.toggle()
                }
            } label: {
                HStack(spacing: 6) {
                    Circle()
                        .fill(OBTheme.success)
                        .frame(width: 6, height: 6)
                    Text(origin.replacingOccurrences(of: "https://", with: ""))
                        .font(.caption.monospaced())
                        .foregroundStyle(OBTheme.muted)
                    Image(systemName: showServerConfig ? "chevron.up" : "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(OBTheme.faint)
                }
            }

            if showServerConfig {
                TextField("https://openboard.thevibecompany.co", text: $origin)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .font(.footnote.monospaced())
                    .padding(12)
                    .background(OBTheme.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(OBTheme.hairline, lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
    }

    private func copyCode(_ code: String) {
        UIPasteboard.general.string = code
        copiedCode = true
        Haptics.light()
        Task {
            try? await Task.sleep(for: .seconds(2))
            copiedCode = false
        }
    }

    private func startDeviceLogin() async {
        isStarting = true
        errorText = nil
        statusMessage = nil
        defer { isStarting = false }

        let cleanedOrigin = origin.trimmingCharacters(in: .whitespacesAndNewlines)
        let api = OpenBoardAPI(origin: cleanedOrigin)
        do {
            let flow = try await api.startDeviceSignIn(clientName: "OpenBoard iOS")
            deviceFlow = flow
            copyCode(flow.userCode)
            statusMessage = "Waiting for browser approval…"
            if let url = URL(string: flow.verificationUri) {
                safariURL = url
            }
            startPolling(api: api, flow: flow, origin: cleanedOrigin)
        } catch {
            errorText = error.localizedDescription
            Haptics.error()
        }
    }

    private func startPolling(api: OpenBoardAPI, flow: DeviceStartResponse, origin: String) {
        pollTask?.cancel()
        pollTask = Task {
            let interval = max(2, flow.interval)
            let deadline = Date().addingTimeInterval(TimeInterval(flow.expiresIn))
            while !Task.isCancelled && Date() < deadline {
                try? await Task.sleep(for: .seconds(interval))
                guard !Task.isCancelled else { return }
                do {
                    let result = try await api.pollDeviceSignIn(deviceCode: flow.deviceCode)
                    if result.pending == true { continue }
                    if let token = result.token, let org = result.org {
                        let boards = result.boards ?? [BoardRef(slug: "main", name: "main", url: nil)]
                        let defaultBoard = boards.first(where: { $0.slug == "main" })?.slug ?? boards.first?.slug ?? "main"
                        let saved = SavedSession(
                            origin: origin,
                            org: org.slug,
                            board: defaultBoard,
                            token: token,
                            orgName: org.name,
                            boards: boards
                        )
                        safariURL = nil
                        Haptics.success()
                        await store.completeSignIn(saved)
                        return
                    }
                } catch OpenBoardAPIError.rateLimited {
                    continue
                } catch {
                    errorText = error.localizedDescription
                    statusMessage = nil
                    Haptics.error()
                    return
                }
            }
            if !Task.isCancelled {
                errorText = "Code expired. Tap Sign in to try again."
                deviceFlow = nil
            }
        }
    }
}

private struct TokenSignInSheet: View {
    @Environment(BoardStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State var origin: String
    @State private var org = "tvc"
    @State private var board = "main"
    @State private var token = ""
    @State private var isVerifying = false
    @State private var errorText: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Board") {
                    TextField("Server URL", text: $origin)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    TextField("Organization (e.g. tvc)", text: $org)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Board (e.g. main)", text: $board)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                Section("Credential") {
                    SecureField("Personal or connection token (obp_… / obc_…)", text: $token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                if let errorText {
                    Section {
                        Text(errorText)
                            .foregroundStyle(OBTheme.danger)
                            .font(.footnote)
                    }
                }
            }
            .navigationTitle("Token Sign-In")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isVerifying ? "Checking…" : "Connect") {
                        Task { await verifyAndSave() }
                    }
                    .disabled(token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isVerifying)
                }
            }
        }
    }

    private func verifyAndSave() async {
        isVerifying = true
        errorText = nil
        defer { isVerifying = false }

        let cleanedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanedOrg = org.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanedBoard = board.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanedOrigin = origin.trimmingCharacters(in: .whitespacesAndNewlines)

        let api = OpenBoardAPI(origin: cleanedOrigin, org: cleanedOrg, board: cleanedBoard, token: cleanedToken)
        do {
            let me = try await api.getMe()
            let resolvedOrg = me.openboard?.org.slug ?? cleanedOrg
            let resolvedBoard = me.openboard?.board.slug ?? cleanedBoard
            let saved = SavedSession(
                origin: cleanedOrigin,
                org: resolvedOrg,
                board: resolvedBoard,
                token: cleanedToken,
                orgName: me.openboard?.org.name,
                boards: [BoardRef(slug: resolvedBoard, name: me.openboard?.board.name ?? resolvedBoard, url: nil)]
            )
            Haptics.success()
            await store.completeSignIn(saved)
            dismiss()
        } catch {
            errorText = error.localizedDescription
            Haptics.error()
        }
    }
}

private struct SafariSheetView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let vc = SFSafariViewController(url: url)
        vc.dismissButtonStyle = .close
        return vc
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}
