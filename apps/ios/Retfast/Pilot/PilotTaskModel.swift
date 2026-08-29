import CoreLocation
import Foundation

/// Pilot flight lifecycle + retrieval requests. iOS polls the small state
/// tables every 5 s (robust with patchy connectivity; the web dashboard uses
/// Realtime — see docs/realtime.md).
@MainActor
final class PilotTaskModel: ObservableObject {
    let event: EventRow

    @Published var task: TaskRow?
    @Published var request: RetrievalRequestRow?
    @Published var assignment: RetrievalAssignmentRow?
    @Published var nearby: [NearbyRetriever] = []
    @Published var error: String?
    @Published var sosDelivered: Bool?

    private var pollTimer: Timer?

    init(event: EventRow, existingTask: TaskRow?) {
        self.event = event
        self.task = existingTask
    }

    var isTracking: Bool { task?.status == .active || task?.status == .landed }

    // MARK: lifecycle

    func startTask() async {
        struct P: Encodable {
            let p_event: UUID
            let p_title: String
        }
        do {
            let task: TaskRow = try await supa
                .rpc("start_task", params: P(p_event: event.id, p_title: ""))
                .execute().value
            self.task = task
            beginTracking(task)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func resumeIfNeeded() {
        if let task, isTracking, !TrackingEngine.shared.isTracking {
            beginTracking(task)
        }
        startPolling()
    }

    private func beginTracking(_ task: TaskRow) {
        TrackingEngine.shared.start(target: .task(id: task.id))
        SyncEngine.shared.start(interval: 15)
        TrackingResume.remember(taskId: task.id, sessionId: nil)
        startPolling()
    }

    func transition(_ action: String, reason: String? = nil) async {
        guard let task else { return }
        struct P: Encodable {
            let p_task: UUID
            let p_action: String
            let p_reason: String?
        }
        do {
            let updated: TaskRow = try await supa
                .rpc("transition_task", params: P(p_task: task.id, p_action: action, p_reason: reason))
                .execute().value
            self.task = updated
            SyncEngine.shared.flushNow()
            if updated.status == .completed || updated.status == .cancelled {
                endTracking()
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func endTracking() {
        TrackingEngine.shared.stop()
        SyncEngine.shared.flushNow()
        TrackingResume.clear()
        stopPolling()
    }

    // MARK: SOS

    func raiseSOS() async {
        struct P: Encodable {
            let p_event: UUID
            let p_task: UUID?
            let p_lat: Double?
            let p_lng: Double?
            let p_message: String
        }
        struct EmergencyRef: Decodable {
            let id: UUID
        }
        let loc = TrackingEngine.shared.lastLocation
        sosDelivered = nil
        do {
            let emergency: EmergencyRef = try await supa.rpc("raise_emergency", params: P(
                p_event: event.id,
                p_task: task?.id,
                p_lat: loc?.coordinate.latitude,
                p_lng: loc?.coordinate.longitude,
                p_message: ""
            )).execute().value
            sosDelivered = true
            SyncEngine.shared.flushNow()
            // Fan out email/notifications; failure here is non-fatal (ops
            // dashboards already see the emergency via Realtime).
            _ = try? await supa.functions.invoke(
                "notify-emergency",
                options: .init(body: ["emergency_id": emergency.id.uuidString])
            )
        } catch {
            sosDelivered = false
            self.error = error.localizedDescription
        }
    }

    // MARK: retrieval

    func loadNearby() async {
        guard let loc = TrackingEngine.shared.lastLocation else { return }
        struct P: Encodable {
            let p_event: UUID
            let p_lat: Double
            let p_lng: Double
            let p_limit: Int
        }
        nearby = (try? await supa.rpc("nearby_retrievers", params: P(
            p_event: event.id,
            p_lat: loc.coordinate.latitude,
            p_lng: loc.coordinate.longitude,
            p_limit: 10
        )).execute().value) ?? []
    }

    func requestRetrieval(from retriever: NearbyRetriever) async {
        guard let task else { return }
        struct P: Encodable {
            let p_task: UUID
            let p_retriever: UUID
        }
        do {
            let req: RetrievalRequestRow = try await supa
                .rpc("request_retrieval", params: P(p_task: task.id, p_retriever: retriever.userId))
                .execute().value
            request = req
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func cancelRequest() async {
        guard let request else { return }
        _ = try? await supa
            .rpc("cancel_retrieval_request", params: ["p_request": request.id])
            .execute()
        self.request = nil
    }

    // MARK: polling

    private func startPolling() {
        guard pollTimer == nil else { return }
        pollTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { await self?.poll() }
        }
    }

    private func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    func poll() async {
        guard let taskId = task?.id else { return }
        if let fresh: TaskRow = try? await supa.from("tasks")
            .select().eq("id", value: taskId).single().execute().value
        {
            task = fresh
        }
        let requests: [RetrievalRequestRow] = (try? await supa.from("retrieval_requests")
            .select()
            .eq("task_id", value: taskId)
            .order("created_at", ascending: false)
            .limit(1)
            .execute().value) ?? []
        request = requests.first
        let assignments: [RetrievalAssignmentRow] = (try? await supa.from("retrieval_assignments")
            .select()
            .eq("task_id", value: taskId)
            .in("status", values: ["assigned", "en_route", "picked_up", "delivered"])
            .limit(1)
            .execute().value) ?? []
        assignment = assignments.first
    }

    deinit {
        pollTimer?.invalidate()
    }
}
