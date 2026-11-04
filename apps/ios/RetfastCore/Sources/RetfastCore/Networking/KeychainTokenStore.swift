import Foundation
import Security

/// Refresh token in the Keychain. `AfterFirstUnlockThisDeviceOnly` so the sync
/// engine can refresh while the phone is locked mid-flight, and the token never
/// migrates to another device via backups.
public final class KeychainTokenStore: TokenStore {
    private let service: String
    private let account = "refresh_token"
    private let cache = LockedBox<String??>(nil)

    public init(service: String = "com.mizibu.retfast.auth") {
        self.service = service
    }

    private var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    public func loadRefreshToken() -> String? {
        if let cached = cache.withLock({ $0 }) { return cached }
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        let token = status == errSecSuccess ? (out as? Data).map { String(decoding: $0, as: UTF8.self) } : nil
        // Don't cache "item not available yet" (device locked before first unlock).
        if status == errSecSuccess || status == errSecItemNotFound { cache.withLock { $0 = .some(token) } }
        return token
    }

    public func saveRefreshToken(_ token: String?) {
        SecItemDelete(baseQuery as CFDictionary)
        if let token {
            var attrs = baseQuery
            attrs[kSecValueData as String] = Data(token.utf8)
            attrs[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(attrs as CFDictionary, nil)
        }
        cache.withLock { $0 = .some(token) }
    }
}
