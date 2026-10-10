import Foundation
import Network
import UIKit

/// Kuyruğu sunucuya toplu ve idempotent biçimde boşaltır.
///
/// Arka planda hayatta kalmak için iki kural (eski iOS uygulamasında sahada öğrenildi):
///  1. Kilit tutarken ASLA uyuma. iOS her konum olayından sonra kısa bir çalışma penceresi verir; backoff bir
///     bekleme değil, kaydedilen bir son tarihtir (`nextAttemptAt`) ve kontrol edilip dönülür.
///  2. Her yüklemeyi bir arka plan görevi (beginBackgroundTask) içine al; istek ortasında askıya alınma.
@MainActor
final class SyncEngine {
    static let shared = SyncEngine()

    private(set) var lastSyncAt: Date?
    private(set) var lastError: String?
    /// Sayaçlar veya hata durumu değişti.
    var onChange: (() -> Void)?
    /// "closed" (sunucu oturumu kapattı) veya "unauthorized" (belirteç geçersiz).
    var onSessionEvent: ((String) -> Void)?

    private var session: TrackingSession?
    private var token = ""
    private var lastFlushAt = Date.distantPast
    private var nextAttemptAt = Date.distantPast
    private var failures = 0
    private var draining = false
    private var timer: Timer?
    private let monitor = NWPathMonitor()

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in self?.flushNow() }
        }
        monitor.start(queue: DispatchQueue(label: "com.mizibu.retfast.netpath"))
    }

    func configure(session: TrackingSession, token: String) {
        self.session = session
        self.token = token
        failures = 0
        nextAttemptAt = .distantPast
        timer?.invalidate()
        // Zamanlayıcı yalnızca ek bir tetikleyici: konum geri çağrısı flushIfDue() ile asıl sürücüdür.
        timer = Timer.scheduledTimer(withTimeInterval: max(5, session.config.uploadIntervalS), repeats: true) { [weak self] _ in
            Task { @MainActor in self?.flushNow() }
        }
        flushNow()
    }

    func updateToken(_ token: String) {
        self.token = token
        nextAttemptAt = .distantPast
        flushNow()
    }

    func shutdown() {
        timer?.invalidate()
        timer = nil
        session = nil
    }

    func flushNow() { Task { await drain(force: true) } }

    func flushIfDue() {
        guard let s = session, Date().timeIntervalSince(lastFlushAt) >= s.config.uploadIntervalS else { return }
        Task { await drain(force: false) }
    }

    private func drain(force: Bool) async {
        guard let s = session, !draining else { return }
        let now = Date()
        if !force, now < nextAttemptAt { return }
        // Zorunlu yükleme kısa backoff'u atlayabilir, uzununa saygı gösterir.
        if force, now < nextAttemptAt, failures > 0, nextAttemptAt.timeIntervalSince(now) > 30 { return }

        draining = true
        lastFlushAt = now
        defer { draining = false }

        var bg = UIBackgroundTaskIdentifier.invalid
        bg = UIApplication.shared.beginBackgroundTask(withName: "retfast.pointsync") {
            if bg != .invalid { UIApplication.shared.endBackgroundTask(bg); bg = .invalid }
        }
        defer { if bg != .invalid { UIApplication.shared.endBackgroundTask(bg); bg = .invalid } }

        // Tek uyanışta sınırlı iş: tüm birikimi tek pencerede göndermeye çalışma.
        for _ in 0 ..< 6 {
            let batch = PointStore.shared.checkout(sessionId: s.sessionId, limit: min(100, s.config.maxBatch))
            if batch.isEmpty { break }
            let rowids = batch.map(\.rowid)
            switch await post(s, points: batch.map(\.point)) {
            case .ok:
                PointStore.shared.confirm(rowids)
                failures = 0
                nextAttemptAt = .distantPast
                lastError = nil
                lastSyncAt = Date()
            case .retry(let why):
                PointStore.shared.rollback(rowids)
                failures += 1
                nextAttemptAt = Date().addingTimeInterval(min(pow(2.0, Double(failures)), 300))
                lastError = why
                onChange?()
                return
            case .unauthorized:
                PointStore.shared.rollback(rowids)
                lastError = "unauthorized"
                nextAttemptAt = Date().addingTimeInterval(120)
                onSessionEvent?("unauthorized")
                onChange?()
                return
            case .closed:
                // Sunucu oturumu kapattı (etkinlik bitti, üyelik sona erdi…): bu noktalar asla kabul edilmez.
                PointStore.shared.purge(sessionId: s.sessionId)
                lastError = "closed"
                onSessionEvent?("closed")
                onChange?()
                return
            case .rejected:
                // Zehirli parti (doğrulama hatası): kuyruğu kilitlemesin diye at.
                PointStore.shared.confirm(rowids)
                lastError = "rejected"
            }
        }

        // Durmuş oturumun kuyruğu boşaldıysa kalıcı durumu temizle.
        if !s.active, PointStore.shared.pendingCount == 0 {
            SessionStore.clear()
            shutdown()
        }
        onChange?()
    }

    private enum Outcome { case ok, retry(String), unauthorized, closed, rejected }

    private func post(_ s: TrackingSession, points: [[String: Any]]) async -> Outcome {
        guard let url = URL(string: "\(s.apiBase)/events/\(s.eventId)/tracking/points"),
              let body = try? JSONSerialization.data(withJSONObject: ["session_id": s.sessionId, "points": points]) else { return .rejected }
        var req = URLRequest(url: url, timeoutInterval: 20)
        req.httpMethod = "POST"
        req.httpBody = body
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            switch code {
            case 200 ..< 300: return .ok
            case 401: return .unauthorized
            case 409:
                let err = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? [String: Any]
                return (err?["code"] as? String) == "TRACKING_SESSION_CLOSED" ? .closed : .retry("http 409")
            case 408, 425, 429, 500 ... 599: return .retry("http \(code)")
            default: return .rejected
            }
        } catch {
            return .retry(error.localizedDescription)
        }
    }
}
