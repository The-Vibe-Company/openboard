import SwiftUI

@main
struct OpenBoardApp: App {
    @State private var store = BoardStore()

    var body: some Scene {
        WindowGroup {
            Group {
                if store.session != nil {
                    MainTabView()
                } else {
                    SignInView()
                }
            }
            .environment(store)
            .preferredColorScheme(colorScheme(for: store.appearance))
            .tint(OBTheme.accent)
        }
    }

    private func colorScheme(for preference: AppearancePreference) -> ColorScheme? {
        switch preference {
        case .system: nil
        case .dark: .dark
        case .light: .light
        }
    }
}
