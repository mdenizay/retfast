import CoreLocation
import UIKit

/// CoreLocation sarmalayıcı. Sunucunun gönderdiği profillere (moving / slow / stationary) göre hareket ve
/// doğruluk temelli uyarlanabilir örnekleme yapar; noktalar önce PointStore'a yazılır, SyncEngine yükler.
///
/// Konum olayı arka planda güvenilir biçimde tetiklenen tek kaynaktır; yükleme de oradan sürülür.
@MainActor
final class TrackingEngine: NSObject, @preconcurrency CLLocationManagerDelegate {
    static let shared = TrackingEngine()

    enum Mode: String { case moving, slow, stationary }

    private let manager = CLLocationManager()
    private var session: TrackingSession?
    private var mode: Mode = .moving
    private var stillSince: Date?
    private var lastRecordedAt: Date?
    private var lastFix: CLLocation?
    private var lastEmit = Date.distantPast
    private var heartbeat: Timer?
    /// Telefonun pusulası (CLHeading). Yalnızca ön plandayken dinlenir: arka planda sürekli manyetometre pil yer.
    private var compass: (deg: Double, at: Date)?
    private(set) var isTracking = false

    var onStatus: (([String: Any]) -> Void)?
    var onSessionEvent: ((String) -> Void)?

    override private init() {
        super.init()
        manager.delegate = self
        manager.pausesLocationUpdatesAutomatically = false
        manager.showsBackgroundLocationIndicator = true
        UIDevice.current.isBatteryMonitoringEnabled = true
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.startHeadingIfNeeded() }
        }
        NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.manager.stopUpdatingHeading() }
        }
        SyncEngine.shared.onChange = { [weak self] in self?.emitStatus(force: true) }
        SyncEngine.shared.onSessionEvent = { [weak self] kind in self?.handleSessionEvent(kind) }
    }

    // MARK: yaşam döngüsü

    func requestPermissions() {
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse: manager.requestAlwaysAuthorization()
        default: break
        }
    }

    var authorization: String {
        switch manager.authorizationStatus {
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .authorizedWhenInUse: return "whenInUse"
        case .authorizedAlways: return "always"
        @unknown default: return "notDetermined"
        }
    }

    func start(_ s: TrackingSession, token: String) {
        var s = s
        s.active = true
        SessionStore.save(s, token: token)
        begin(s, token: token)
    }

    /// Uygulama konum olayıyla (significant change) yeniden başlatıldığında veya normal açılışta çağrılır.
    func resumeIfNeeded() {
        guard !isTracking, let (s, token) = SessionStore.load() else { return }
        if s.active {
            begin(s, token: token)
        } else {
            // Konum durmuş ama kuyrukta yüklenmemiş nokta var.
            SyncEngine.shared.configure(session: s, token: token)
        }
    }

    private func begin(_ s: TrackingSession, token: String) {
        session = s
        mode = .moving
        stillSince = nil
        lastRecordedAt = nil
        manager.activityType = s.role == "retriever" ? .automotiveNavigation : .otherNavigation
        apply(profile: s.config.moving)
        // allowsBackgroundLocationUpdates, "location" arka plan modu olmadan çökertir; yanlış derlenmiş paket yalnızca
        // arka plan takibini kaybetsin, uçuş ortasında çökmesin.
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
        manager.allowsBackgroundLocationUpdates = modes.contains("location")
        manager.startUpdatingLocation()
        // iOS süreci öldürürse bu olay uygulamayı yeniden başlatır ve LaunchSubscriber takibi sürdürür.
        manager.startMonitoringSignificantLocationChanges()
        isTracking = true
        startHeadingIfNeeded()
        SyncEngine.shared.configure(session: s, token: token)
        startHeartbeat()
        emitStatus(force: true)
    }

    func stop() {
        manager.stopUpdatingLocation()
        manager.stopMonitoringSignificantLocationChanges()
        manager.stopUpdatingHeading()
        manager.allowsBackgroundLocationUpdates = false
        heartbeat?.invalidate()
        heartbeat = nil
        isTracking = false
        if var s = session {
            s.active = false
            session = s
            if let token = Keychain.get(account: "api-token") { SessionStore.save(s, token: token) }
            SyncEngine.shared.configure(session: s, token: Keychain.get(account: "api-token") ?? "")
        }
        emitStatus(force: true)
    }

    func clearAll() {
        stop()
        if let s = session { PointStore.shared.purge(sessionId: s.sessionId) }
        SessionStore.clear()
        SyncEngine.shared.shutdown()
        session = nil
        emitStatus(force: true)
    }

    private func handleSessionEvent(_ kind: String) {
        if kind == "closed" {
            stop()
            SessionStore.clear()
            SyncEngine.shared.shutdown()
        }
        onSessionEvent?(kind)
    }

    // MARK: profiller

    private func profile(_ m: Mode) -> ProfileConfig {
        guard let c = session?.config else { return ProfileConfig(intervalS: 10, distanceM: 20, accuracy: "ten_meters") }
        switch m {
        case .moving: return c.moving
        case .slow: return c.slow
        case .stationary: return c.stationary
        }
    }

    private func apply(profile p: ProfileConfig) {
        switch p.accuracy {
        case "best": manager.desiredAccuracy = kCLLocationAccuracyBest
        case "ten_meters": manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        default: manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        }
        manager.distanceFilter = max(0, p.distanceM)
    }

    private var batteryLow: Bool {
        guard let c = session?.config else { return false }
        let level = UIDevice.current.batteryLevel
        let state = UIDevice.current.batteryState
        return level >= 0 && Double(level * 100) < c.lowBatteryPct && state != .charging && state != .full
    }

    private func classify(_ loc: CLLocation) -> Mode {
        guard let c = session?.config else { return .moving }
        let v = loc.speed >= 0 ? loc.speed : 0
        if v >= c.movingSpeedMps {
            stillSince = nil
            return .moving
        }
        if v < c.stationarySpeedMps {
            if stillSince == nil { stillSince = loc.timestamp }
            return loc.timestamp.timeIntervalSince(stillSince ?? loc.timestamp) >= c.stationaryAfterS ? .stationary : .slow
        }
        stillSince = nil
        return .slow
    }

    /// Hareketsiz kullanıcıda iOS, distanceFilter yüzünden olay üretmez; yine de "canlı" görünmesi için seyrek,
    /// tek seferlik konum iste (konum güncellemeleri açıkken süreç arka planda askıya alınmaz).
    private func startHeartbeat() {
        heartbeat?.invalidate()
        guard let s = session else { return }
        heartbeat = Timer.scheduledTimer(withTimeInterval: max(30, s.config.heartbeatS), repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.isTracking, self.mode == .stationary else { return }
                self.manager.requestLocation()
            }
        }
    }

    // MARK: yön

    private func startHeadingIfNeeded() {
        guard isTracking, CLLocationManager.headingAvailable(), UIApplication.shared.applicationState == .active else { return }
        manager.headingFilter = 5
        manager.startUpdatingHeading()
    }

    /// Baktığı yön: yeterince hızlı hareket ediyorsa GPS rotası (uçuşta ve araçta doğru), değilse pusula.
    private func effectiveHeading(_ fix: CLLocation?) -> Double? {
        if let f = fix, f.speed >= 1.0, f.course >= 0 { return f.course }
        if let c = compass, Date().timeIntervalSince(c.at) < 15 { return c.deg }
        return nil
    }

    func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        guard newHeading.headingAccuracy >= 0 else { return }
        let h = newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading
        guard h >= 0 else { return }
        compass = (h, Date())
        emitStatus(force: false)
    }

    func locationManagerShouldDisplayHeadingCalibration(_ manager: CLLocationManager) -> Bool { false }

    // MARK: CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { emitStatus(force: true) }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let s = session, isTracking else { return }
        for loc in locations {
            // Geçersiz veya çok kaba fix izi zehirlemesin.
            guard loc.horizontalAccuracy >= 0, loc.horizontalAccuracy <= 300 else { continue }
            lastFix = loc
            let next = classify(loc)
            if next != mode {
                mode = next
                apply(profile: profile(next))
            }
            let p = profile(mode)
            let minInterval = p.intervalS * (batteryLow ? s.config.lowBatteryFactor : 1)
            if let last = lastRecordedAt {
                let dt = loc.timestamp.timeIntervalSince(last)
                if dt < 0 || dt < minInterval * 0.9 { continue }
            }
            lastRecordedAt = loc.timestamp
            record(loc, session: s)
        }
        // Konum geri çağrısı arka planda güvenilir çalışan tek tetikleyici: yüklemeyi de buradan sür.
        SyncEngine.shared.flushIfDue()
        emitStatus(force: false)
    }

    private func record(_ loc: CLLocation, session s: TrackingSession) {
        let t = Int64(loc.timestamp.timeIntervalSince1970 * 1000)
        var point: [String: Any] = ["t": t, "lat": loc.coordinate.latitude, "lon": loc.coordinate.longitude, "acc": loc.horizontalAccuracy]
        if loc.verticalAccuracy >= 0 { point["alt"] = loc.altitude }
        if loc.speed >= 0 { point["spd"] = loc.speed }
        if let h = effectiveHeading(loc) { point["hdg"] = h }
        let level = UIDevice.current.batteryLevel
        if level >= 0 { point["bat"] = Int((level * 100).rounded()) }
        PointStore.shared.enqueue(sessionId: s.sessionId, t: t, point: point)
    }

    /// iOS güncellemeleri duraklattıysa sürdür; yere inmiş pilot haritadan sessizce düşmesin.
    func locationManagerDidPauseLocationUpdates(_ manager: CLLocationManager) {
        guard isTracking else { return }
        manager.startUpdatingLocation()
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Geçici GPS hataları beklenir; bayatlık arayüzde son fix yaşından görünür.
    }

    // MARK: durum

    func status() -> [String: Any] {
        var out: [String: Any] = [
            "tracking": isTracking,
            "pending": PointStore.shared.pendingCount,
            "authorization": authorization,
            "mode": mode.rawValue,
            "batteryLow": batteryLow,
        ]
        if let id = session?.eventId { out["eventId"] = id }
        let level = UIDevice.current.batteryLevel
        if level >= 0 { out["battery"] = Int((level * 100).rounded()) }
        if let f = lastFix {
            var fix: [String: Any] = ["lat": f.coordinate.latitude, "lon": f.coordinate.longitude, "acc": f.horizontalAccuracy, "t": Int64(f.timestamp.timeIntervalSince1970 * 1000)]
            if let h = effectiveHeading(f) { fix["hdg"] = h }
            out["lastFix"] = fix
        }
        if let t = SyncEngine.shared.lastSyncAt { out["lastSyncAt"] = Int64(t.timeIntervalSince1970 * 1000) }
        if let e = SyncEngine.shared.lastError { out["lastError"] = e }
        return out
    }

    private func emitStatus(force: Bool) {
        let now = Date()
        guard force || now.timeIntervalSince(lastEmit) >= 1 else { return }
        lastEmit = now
        onStatus?(status())
    }
}
