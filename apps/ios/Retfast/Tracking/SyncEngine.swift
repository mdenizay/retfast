import Foundation
import Network
import UIKit

/// Drains PointBuffer to the `ingest_location_points` RPC in idempotent
/// batches (docs/ios-tracking.md).
///
/// Everything here is `@MainActor`-isolated on purpose: this object is driven
/// from the CoreLocation delegate, a `Timer`, `NWPathMonitor`'s queue and
/// SwiftUI, and the previous free-threaded version raced on its `draining` /
/// `backoff` state.
///
/// Two rules keep the app alive in the background:
///
///  1. **Never sleep while holding the drain lock.** iOS grants only a short
///     execution window after each background location event. The old code
///     slept up to 300 s for backoff inside `drain()`, so suspension stopped
///     `defer` from ever clearing `draining` — sync then wedged permanently and
///     the buffer grew until jetsam killed the app. Backoff is now a
///     *deadline* that is checked and returned from, never slept through.
///  2. **Hold a background-task assertion across each upload**, so iOS does not
///     suspend the process mid-request.
@MainActor
final class SyncEngine: ObservableObject {
    static let shared = SyncEngine()

    @Published private(set) var pendingCount = 0
    @Published private(set) var lastSyncAt: Date?
    @Published private(set) var lastError: String?

    /// Flush at most this often when driven by incoming location fixes.
    private var cadence: TimeInterval = 15
    private var lastFlushAt: Date = .distantPast
    private var nextAttemptAt: Date = .distantPast
    private var consecutiveFailures = 0
    private var draining = false

    private var timer: Timer?
    private let pathMonitor = NWPathMonitor()

    private init() {
        pathMonitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in self?.flushNow() }
        }
        pathMonitor.start(queue: DispatchQueue(label: "com.mizibu.retfast.netpath"))
        pendingCount = PointBuffer.shared.pendingCount
    }

    func start(interval: TimeInterval = 15) {
        cadence = interval
        stop()
        // A timer is a *supplement*: it does not fire reliably once the app is
        // suspended, which is why TrackingEngine also calls flushIfDue() from
        // every location callback.
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.flushNow() }
        }
        flushNow()
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    /// Flush unconditionally (landed, SOS, task finished, app backgrounded).
    func flushNow() {
        Task { await drain(force: true) }
    }

    /// Called for every location fix; respects the cadence and any backoff.
    func flushIfDue() {
        guard Date().timeIntervalSince(lastFlushAt) >= cadence else { return }
        Task { await drain(force: false) }
    }

    private func drain(force: Bool) async {
        guard !draining else { return }
        let now = Date()
        // Backoff is a deadline, never a sleep — see the note above.
        if !force, now < nextAttemptAt { return }
        if force, now < nextAttemptAt, consecutiveFailures > 0 {
            // A forced flush may skip a *short* backoff but must still respect
            // a long one, otherwise we hammer a failing server.
            if nextAttemptAt.timeIntervalSince(now) > 30 { return }
        }

        draining = true
        lastFlushAt = now
        defer { draining = false }

        // Keep the process alive across the upload.
        var bgTask = UIBackgroundTaskIdentifier.invalid
        bgTask = UIApplication.shared.beginBackgroundTask(withName: "retfast.pointsync") {
            // Expiration handler: iOS is reclaiming the assertion.
            if bgTask != .invalid {
                UIApplication.shared.endBackgroundTask(bgTask)
                bgTask = .invalid
            }
        }
        defer {
            if bgTask != .invalid {
                UIApplication.shared.endBackgroundTask(bgTask)
                bgTask = .invalid
            }
        }

        // Bounded work per wake-up: never try to push the whole backlog inside
        // one short background window.
        for _ in 0 ..< 5 {
            let batch = PointBuffer.shared.checkoutBatch(limit: 100)
            if batch.isEmpty { break }
            let ids = batch.map(\.id)
            do {
                let data = try JSONSerialization.data(withJSONObject: batch.map(\.payload))
                let json = try JSONDecoder().decode(JSONValue.self, from: data)
                _ = try await supa.rpc("ingest_location_points", params: ["p_points": json]).execute()
                PointBuffer.shared.confirm(ids: ids)
                consecutiveFailures = 0
                nextAttemptAt = .distantPast
                lastError = nil
                lastSyncAt = Date()
            } catch {
                PointBuffer.shared.rollback(ids: ids)
                consecutiveFailures += 1
                // 2, 4, 8 … capped at 300 s — recorded, not slept.
                let delay = min(pow(2.0, Double(consecutiveFailures)), 300)
                nextAttemptAt = Date().addingTimeInterval(delay)
                lastError = error.localizedDescription
                break
            }
        }

        pendingCount = PointBuffer.shared.pendingCount
    }
}
