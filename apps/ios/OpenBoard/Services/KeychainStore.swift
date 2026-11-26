import Foundation
import Security

enum KeychainStore {
    private static let service = "co.thevibecompany.openboard"
    private static let sessionAccount = "session.v1"
    private static let claimsAccount = "task-claims.v2"

    static func loadSession() -> SavedSession? {
        guard let data = read(account: sessionAccount) else { return nil }
        return try? JSONDecoder().decode(SavedSession.self, from: data)
    }

    static func saveSession(_ session: SavedSession) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        _ = write(data: data, account: sessionAccount)
    }

    static func clearSession() {
        delete(account: sessionAccount)
        delete(account: claimsAccount)
        delete(account: "task-claims.v1")
    }

    static func loadClaims() -> [ClaimScope: LocalTaskClaim] {
        guard let data = read(account: claimsAccount) else { return [:] }
        return (try? JSONDecoder().decode([ClaimScope: LocalTaskClaim].self, from: data)) ?? [:]
    }

    static func saveClaims(_ claims: [ClaimScope: LocalTaskClaim]) -> Bool {
        guard let data = try? JSONEncoder().encode(claims) else { return false }
        return write(data: data, account: claimsAccount)
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

    private static func write(data: Data, account: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let attributes: [String: Any] = [kSecValueData as String: data]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        guard status == errSecItemNotFound else { return status == errSecSuccess }

        var item = query.merging(attributes) { _, value in value }
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let added = SecItemAdd(item as CFDictionary, nil)
        if added == errSecDuplicateItem {
            return SecItemUpdate(query as CFDictionary, attributes as CFDictionary) == errSecSuccess
        }
        return added == errSecSuccess
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

struct ClaimScope: Codable, Hashable, Sendable {
    let origin: String
    let org: String
    let board: String
    let actor: String
    let taskID: String

    init(api: OpenBoardAPI, actor: String, taskID: String) {
        (origin, org, board) = (api.origin, api.org, api.board)
        self.actor = actor
        self.taskID = taskID
    }

    func activeClaim(in claims: [Self: LocalTaskClaim], epoch: Int, now: Date) -> LocalTaskClaim? {
        guard let claim = claims[self], claim.epoch == epoch,
              let until = TextFormatting.parseISO(claim.until),
              until > now else { return nil }
        return claim
    }
}
