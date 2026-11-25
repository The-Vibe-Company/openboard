import SwiftUI
import UIKit

enum OBTheme {
    static let background = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ? UIColor(red: 0.0, green: 0.0, blue: 0.0, alpha: 1) : UIColor.systemBackground
    })

    static let surface = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ? UIColor(red: 0.055, green: 0.055, blue: 0.063, alpha: 1) : UIColor(red: 0.98, green: 0.98, blue: 0.984, alpha: 1)
    })

    static let surfaceRaised = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ? UIColor(red: 0.095, green: 0.095, blue: 0.105, alpha: 1) : UIColor.white
    })

    static let hairline = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ? UIColor(white: 1.0, alpha: 0.13) : UIColor(white: 0.0, alpha: 0.10)
    })

    static let shade = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ? UIColor(white: 1.0, alpha: 0.07) : UIColor(white: 0.0, alpha: 0.045)
    })

    static let text = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ? UIColor(red: 0.93, green: 0.93, blue: 0.94, alpha: 1) : UIColor(red: 0.09, green: 0.09, blue: 0.10, alpha: 1)
    })

    static let muted = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ? UIColor(red: 0.63, green: 0.63, blue: 0.67, alpha: 1) : UIColor(red: 0.40, green: 0.40, blue: 0.44, alpha: 1)
    })

    static let faint = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ? UIColor(red: 0.48, green: 0.48, blue: 0.52, alpha: 1) : UIColor(red: 0.52, green: 0.52, blue: 0.56, alpha: 1)
    })

    static let accent = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark ? UIColor(red: 0.20, green: 0.57, blue: 1.0, alpha: 1) : UIColor(red: 0.0, green: 0.44, blue: 0.95, alpha: 1)
    })

    static let success = Color(red: 0.27, green: 0.72, blue: 0.43)
    static let warning = Color(red: 0.96, green: 0.65, blue: 0.14)
    static let danger = Color(red: 0.90, green: 0.28, blue: 0.30)
    static let purple = Color(red: 0.65, green: 0.54, blue: 0.98)

    static func color(for state: TaskStateKind) -> Color {
        switch state {
        case .ready: accent
        case .claimed: warning
        case .completed: success
        case .failed: danger
        case .blocked: purple
        case .waiting, .canceled: muted
        }
    }
}

enum Haptics {
    @MainActor static func light() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    @MainActor static func medium() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    @MainActor static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    @MainActor static func error() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }
}

enum TextFormatting {
    private static let isoWithFraction = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    private static let isoStandard = Date.ISO8601FormatStyle(includingFractionalSeconds: false)

    static func parseISO(_ raw: String) -> Date? {
        (try? isoWithFraction.parse(raw)) ?? (try? isoStandard.parse(raw))
    }

    static func relativeAge(_ raw: String, now: Date = .now) -> String {
        guard let date = parseISO(raw) else { return "" }
        let seconds = max(0, Int(now.timeIntervalSince(date)))
        if seconds < 45 { return "now" }
        if seconds < 3600 { return "\(seconds / 60)m" }
        if seconds < 86400 { return "\(seconds / 3600)h" }
        if seconds < 86400 * 30 { return "\(seconds / 86400)d" }
        return "\(seconds / (86400 * 30))mo"
    }

    static func previewLine(_ text: String, mentions: [MessageMention]? = nil, fallback: String) -> String {
        var resolved = text
        if let mentions {
            for mention in mentions {
                if let actor = mention.actor {
                    resolved = resolved.replacingOccurrences(of: mention.written, with: "@\(actor.handle)")
                }
            }
        }
        let firstLine = resolved
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .first(where: { !$0.isEmpty }) ?? ""
        let stripped = firstLine
            .replacingOccurrences(of: #"^#{1,6}\s+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "**", with: "")
            .replacingOccurrences(of: "`", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return stripped.isEmpty ? fallback : stripped
    }

    static func markdownAttributed(_ text: String, mentions: [MessageMention]? = nil) -> AttributedString {
        var resolved = text
        if let mentions {
            for mention in mentions {
                if let actor = mention.actor {
                    resolved = resolved.replacingOccurrences(of: mention.written, with: "@\(actor.handle)")
                }
            }
        }
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace,
            failurePolicy: .returnPartiallyParsedIfPossible
        )
        return (try? AttributedString(markdown: resolved, options: options)) ?? AttributedString(resolved)
    }
}
