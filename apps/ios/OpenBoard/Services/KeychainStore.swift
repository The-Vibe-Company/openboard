import Foundation
import Security

enum KeychainStore {
    private static let service = "co.thevibecompany.openboard"
    private static let sessionAccount = "session.v1"
    private static let claimsAccount = "task-claims.v1"

    static func loadSession() -> SavedSession? {
        guard let data = read(account: sessionAccount) else { return nil }
        return try? JSONDecoder().decode(SavedSession.self, from: data)
    }

    static func saveSession(_ session: SavedSession) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        write(data: data, account: sessionAccount)
    }

    static func clearSession() {
        delete(account: sessionAccount)
        delete(account: claimsAccount)
    }

    static func loadClaims() -> [String: LocalTaskClaim] {
        guard let data = read(account: claimsAccount) else { return [:] }
        return (try? JSONDecoder().decode([String: LocalTaskClaim].self, from: data)) ?? [:]
    }

    static func saveClaims(_ claims: [String: LocalTaskClaim]) {
        guard let data = try? JSONEncoder().encode(claims) else { return }
        write(data: data, account: claimsAccount)
    }

    private static func read(account: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else { return nil }
        return result as? Data
    }

    private static func write(data: Data, account: String) {
        delete(account: account)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    private static func delete(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
