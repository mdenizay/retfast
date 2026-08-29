import Foundation
import Network

/// Drains PointBuffer to the `ingest_location_points` RPC in idempotent
/// batches with exponential backoff (docs/ios-tracking.md).
final class SyncEngine: ObservableObject {
    static let shared = SyncEngine()

    @Published private(set) var pendingCount = 0
    @Published private(set) var lastSyncAt: Date?
    @Published private(set) var lastError: String?

    private var timer: Timer?
    private var backoff: TimeInterval = 0
    private var draining = false
    private let pathMonitor = NWPathMonitor()

    private init() {
        pathMonitor.pathUpdateHandler = { [weak self] path in
            if path.status == .satisfied {
                Task { await self?.drain() }
            }
        }
        pathMonitor.start(queue: DispatchQueue(label: "com.mizibu.retfast.netpath"))
    }

    func start(interval: TimeInterval = 15) {
        stop()
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { await self?.drain() }
        }
        Task { await drain() }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    /// Flush immediately (landed, SOS, task finished, app backgrounded).
    func flushNow() {
        Task { await drain() }
    }

    @MainActor
    private func setState(pending: Int, error: String?) {
        pendingCount = pending
        lastError = error
        if error == nil { lastSyncAt = Date() }
    }

    func drain() async {
        guard !draining else { return }
        draining = true
        defer { draining = false }

        if backoff > 0 {
            try? await Task.sleep(nanoseconds: UInt64(backoff * 1_000_000_000))
        }

        while true {
            let batch = PointBuffer.shared.checkoutBatch(limit: 100)
            if batch.isEmpty { break }
            let ids = batch.map(\.id)
            do {
                let payload = try JSONSerialization.data(withJSONObject: batch.map(\.payload))
                let json = try JSONDecoder().decode(JSONValue.self, from: payload)
                _ = try await supa.rpc("ingest_location_points", params: ["p_points": json]).execute()
                PointBuffer.shared.confirm(ids: ids)
                backoff = 0
                await setState(pending: PointBuffer.shared.pendingCount, error: nil)
            } catch {
                PointBuffer.shared.rollback(ids: ids)
                backoff = min(max(backoff * 2, 2), 300)
                await setState(pending: PointBuffer.shared.pendingCount, error: error.localizedDescription)
                break
            }
        }
        await setState(pending: PointBuffer.shared.pendingCount, error: lastError)
    }
}
