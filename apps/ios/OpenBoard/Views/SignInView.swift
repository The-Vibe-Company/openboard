import AuthenticationServices
import SwiftUI

enum OAuthCallbackResult: Equatable, Sendable {
    case code(String)
    case error(String)
}

enum OAuthCallbackParser {
    static func makeAuthURL(origin: String, clientState: String) -> URL? {
        let trimmed = origin.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        var components = URLComponents(string: "\(trimmed)/auth/github/start")
        components?.queryItems = [
            URLQueryItem(name: "app", value: "ios"),
            URLQueryItem(name: "client_state", value: clientState),
        ]
        return components?.url
    }

    static func parse(url: URL, expectedState: String) -> OAuthCallbackResult {
        guard url.scheme?.lowercased() == "openboard",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else {
            return .error("Unexpected sign-in callback URL.")
        }
        let params = Dictionary(
            uniqueKeysWithValues: (components.queryItems ?? []).compactMap { item in
                item.value.map { (item.name, $0) }
            }
        )
        guard params["state"] == expectedState else {
            return .error("Sign-in state mismatch. Please try again.")
        }
        if let err = params["error"] {
            if err == "no_org" {
                return .error("Your GitHub account is not a member of an OpenBoard organization yet.")
            }
            return .error("Sign-in could not be completed (\(err)).")
        }
        guard let code = params["code"], !code.isEmpty else {
            return .error("Missing authorization code from OpenBoard.")
        }
        return .code(code)
    }

    static func generateState() -> String {
        (UUID().uuidString + UUID().uuidString)
            .replacingOccurrences(of: "-", with: "")
            .lowercased()
    }
}

struct SignInView: View {
    @Environment(BoardStore.self) private var store
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession

    @State private var origin = SavedSession.productionOrigin
    @State private var showServerConfig = false
    @State private var showTokenSheet = false

    @State private var isSigningIn = false
    @State private var errorText: String?

    var body: some View {
        NavigationStack {
            ZStack {
                OBTheme.background.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 28) {
                        Spacer(minLength: 48)
                        brandHeader
                        primaryActionsCard
                        serverDisclosure
                        Spacer(minLength: 24)
                    }
                    .padding(.horizontal, 22)
                }
            }
            .sheet(isPresented: $showTokenSheet) {
                TokenSignInSheet(origin: origin)
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
                Task { await signInWithGitHub() }
            } label: {
                HStack(spacing: 10) {
                    if isSigningIn {
                        ProgressView()
                            .tint(OBTheme.background)
                    } else {
                        Image(systemName: "person.badge.key.fill")
                    }
                    Text(isSigningIn ? "Signing in…" : "Continue with GitHub")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(OBTheme.text)
                .foregroundStyle(OBTheme.background)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .disabled(isSigningIn)

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
            .disabled(isSigningIn)

            if let errorText {
                Text(errorText)
                    .font(.footnote)
                    .foregroundStyle(OBTheme.danger)
                    .multilineTextAlignment(.center)
                    .padding(.top, 4)
            }
        }
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

    private func signInWithGitHub() async {
        isSigningIn = true
        errorText = nil
        defer { isSigningIn = false }

        let cleanedOrigin = origin.trimmingCharacters(in: .whitespacesAndNewlines)
        let clientState = OAuthCallbackParser.generateState()
        guard let authURL = OAuthCallbackParser.makeAuthURL(origin: cleanedOrigin, clientState: clientState) else {
            errorText = "Invalid server URL."
            Haptics.error()
            return
        }

        do {
            let callbackURL = try await webAuthenticationSession.authenticate(
                using: authURL,
                callbackURLScheme: "openboard",
                preferredBrowserSession: .shared
            )

            switch OAuthCallbackParser.parse(url: callbackURL, expectedState: clientState) {
            case .error(let message):
                errorText = message
                Haptics.error()
            case .code(let code):
                let api = OpenBoardAPI(origin: cleanedOrigin)
                let result = try await api.pollDeviceSignIn(deviceCode: code)
                guard let token = result.token, let org = result.org else {
                    errorText = "Sign-in token could not be issued. Please try again."
                    Haptics.error()
                    return
                }
                let boards = result.boards ?? [BoardRef(slug: "main", name: "main", url: nil)]
                let defaultBoard = boards.first(where: { $0.slug == "main" })?.slug ?? boards.first?.slug ?? "main"
                let saved = SavedSession(
                    origin: cleanedOrigin,
                    org: org.slug,
                    board: defaultBoard,
                    token: token,
                    orgName: org.name,
                    boards: boards
                )
                Haptics.success()
                await store.completeSignIn(saved)
            }
        } catch let authError as ASWebAuthenticationSessionError where authError.code == .canceledLogin {
            // User cancelled the native sheet — return quietly.
        } catch {
            errorText = error.localizedDescription
            Haptics.error()
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
