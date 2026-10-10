import ExpoModulesCore

/// `start` seçenekleri: { api_base, token, event_id, session_id, role, config } (config: sunucudan gelen takip ayarları).
struct StartOptions: Decodable {
    var apiBase: String
    var token: String
    var eventId: String
    var sessionId: String
    var role: String
    var config: TrackingConfig
}

/// Ana iş parçacığına bağlı motoru, Expo'nun kapanış tabanlı tanımından ayrı tutan ince köprü.
/// (Tanımın içinde karmaşık kapanışlar Swift derleyicisini yanıltıyor.)
/// Motor ana iş parçacığına bağlıdır; senkron `Function` JS iş parçacığında çalıştığı için güvenle ana iş
/// parçacığına geçer (zaten ana iş parçacığındaysak doğrudan çalıştırır, kilitlenme olmaz).
func onMain<T>(_ body: @MainActor () -> T) -> T {
    if Thread.isMainThread { return MainActor.assumeIsolated(body) }
    return DispatchQueue.main.sync { MainActor.assumeIsolated(body) }
}

enum TrackingBridge {
    static func status() -> [String: Any] {
        onMain { TrackingEngine.shared.status() }
    }

    static func requestPermissions() -> String {
        onMain {
            TrackingEngine.shared.requestPermissions()
            return TrackingEngine.shared.authorization
        }
    }

    static func start(_ json: String) throws {
        let dec = JSONDecoder()
        dec.keyDecodingStrategy = .convertFromSnakeCase
        let o = try dec.decode(StartOptions.self, from: Data(json.utf8))
        let s = TrackingSession(apiBase: o.apiBase, eventId: o.eventId, sessionId: o.sessionId, role: o.role, config: o.config)
        onMain { TrackingEngine.shared.start(s, token: o.token) }
    }

    static func stop() { onMain { TrackingEngine.shared.stop() } }
    static func reset() { onMain { TrackingEngine.shared.clearAll() } }
    static func flush() { onMain { SyncEngine.shared.flushNow() } }

    static func updateToken(_ token: String) {
        SessionStore.updateToken(token)
        onMain { SyncEngine.shared.updateToken(token) }
    }

    static func bind(onStatus: @escaping ([String: Any]) -> Void, onSession: @escaping (String) -> Void) {
        onMain {
            TrackingEngine.shared.onStatus = onStatus
            TrackingEngine.shared.onSessionEvent = onSession
            // Normal açılışta, JS başlamadan önce açık oturum varsa native tarafı sürdür.
            TrackingEngine.shared.resumeIfNeeded()
        }
    }
}

/// JS yüzeyi: başlat/durdur/durum. Takibin kendisi JS'e bağlı değildir; uygulama arka plandayken veya
/// yeniden başlatıldığında native taraf kendi başına sürer.
public class RetfastTrackingModule: Module {
    public func definition() -> ModuleDefinition {
        Name("RetfastTracking")

        Events("onStatus", "onSessionEvent")

        OnCreate {
            TrackingBridge.bind(
                onStatus: { [weak self] status in self?.sendEvent("onStatus", status) },
                onSession: { [weak self] kind in self?.sendEvent("onSessionEvent", ["kind": kind]) }
            )
        }

        Function("getStatus") { () -> [String: Any] in
            TrackingBridge.status()
        }

        AsyncFunction("requestPermissions") { () -> String in
            TrackingBridge.requestPermissions()
        }.runOnQueue(.main)

        AsyncFunction("start") { (optionsJson: String) throws in
            try TrackingBridge.start(optionsJson)
        }.runOnQueue(.main)

        /// Konumu durdurur; kuyrukta kalan noktalar yüklenene kadar senkron sürer.
        AsyncFunction("stop") { () in
            TrackingBridge.stop()
        }.runOnQueue(.main)

        /// Çıkış yaparken: oturumu ve yüklenmemiş noktaları tamamen sil.
        AsyncFunction("reset") { () in
            TrackingBridge.reset()
        }.runOnQueue(.main)

        AsyncFunction("flush") { () in
            TrackingBridge.flush()
        }.runOnQueue(.main)

        AsyncFunction("updateToken") { (token: String) in
            TrackingBridge.updateToken(token)
        }.runOnQueue(.main)
    }
}
