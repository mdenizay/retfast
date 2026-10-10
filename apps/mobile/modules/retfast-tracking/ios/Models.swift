import Foundation

/// Sunucunun `POST /events/{id}/tracking/start` yanıtındaki uyarlanabilir takip ayarları.
struct ProfileConfig: Codable {
    var intervalS: Double
    var distanceM: Double
    var accuracy: String
}

struct TrackingConfig: Codable {
    var moving: ProfileConfig
    var slow: ProfileConfig
    var stationary: ProfileConfig
    var movingSpeedMps: Double
    var stationarySpeedMps: Double
    var stationaryAfterS: Double
    var lowBatteryPct: Double
    var lowBatteryFactor: Double
    var uploadIntervalS: Double
    var uploadBatch: Int
    var maxBatch: Int
    var heartbeatS: Double
}

/// Açık takip oturumu. Uygulama öldürülüp yeniden başladığında konum modülü bunu okuyup kendiliğinden sürdürür;
/// JS'in açılmasını beklemez.
struct TrackingSession: Codable {
    /// false: konum durdu ama kuyrukta yüklenmemiş noktalar var; yükleme bitince oturum silinir.
    var active: Bool = true
    var apiBase: String
    var eventId: String
    var sessionId: String
    var role: String
    var config: TrackingConfig
}

enum SessionStore {
    private static let key = "rf.tracking.session"
    private static let tokenAccount = "api-token"

    static func save(_ s: TrackingSession, token: String) {
        let enc = JSONEncoder()
        enc.keyEncodingStrategy = .convertToSnakeCase
        if let data = try? enc.encode(s) { UserDefaults.standard.set(data, forKey: key) }
        Keychain.set(token, account: tokenAccount)
    }

    static func load() -> (TrackingSession, String)? {
        guard let data = UserDefaults.standard.data(forKey: key), let token = Keychain.get(account: tokenAccount) else { return nil }
        let dec = JSONDecoder()
        dec.keyDecodingStrategy = .convertFromSnakeCase
        guard let s = try? dec.decode(TrackingSession.self, from: data) else { return nil }
        return (s, token)
    }

    static func updateToken(_ token: String) { Keychain.set(token, account: tokenAccount) }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
        Keychain.delete(account: tokenAccount)
    }
}

/// Belirteç yalnızca Keychain'de durur; cihaz yeniden başlatıldıktan sonra ilk kilit açılışından itibaren
/// arka planda okunabilir (`AfterFirstUnlock`).
enum Keychain {
    private static let service = "com.mizibu.retfast"

    static func set(_ value: String, account: String) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    static func get(account: String) -> String? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account,
            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(account: String) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(q as CFDictionary)
    }
}
