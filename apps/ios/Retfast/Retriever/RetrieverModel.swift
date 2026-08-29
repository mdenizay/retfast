import CoreLocation
import Foundation

struct RetrieverProfileRow: Codable {
    var availability: RetrieverAvailability
    var vehicleCapacity: Int
    var occupiedSeats: Int
    var vehicleDescription: String

    enum CodingKeys: String, CodingKey {
        case availability
        case vehicleCapacity = "vehicle_capacity"
        case occupiedSeats = "occupied_seats"
        case vehicleDescription = "vehicle_description"
    }
}

struct PilotPin: Identifiable {
    let id: UUID // task id
    let name: String
    let coordinate: CLLocationCoordinate2D
}

/// Retriever duty: continuous breadcrumbs while on duty, incoming 60 s
/// offers, and the assignment workflow
/// requested → accepted → en route → picked up → delivered → completed.
@MainActor
final class RetrieverModel: ObservableObject {
    let event: EventRow

    @Published var onDuty = false
    @Published var profileRow: RetrieverProfileRow?
    @Published var pendingRequest: RetrievalRequestRow?
    @Published var assignments: [RetrievalAssignmentRow] = []
    @Published var pilotNames: [UUID: String] = [:]
    @Published var pilotPins: [PilotPin] = []
    @Published var error: String?

    private var session: RetrieverSession?
    private var pollTimer: Timer?

    init(event: EventRow) {
        self.event = event
    }

    func appear() async {
        // Resume an open duty session if the app was relaunched.
        if let open: [RetrieverSession] = try? await supa.from("retriever_sessions")
            .select("id, event_id")
            .eq("event_id", value: event.id)
            .is("ended_at", value: nil)
            .execute().value,
            let s = open.first
        {
            session = s
            onDuty = true
            if !TrackingEngine.shared.isTracking {
                TrackingEngine.shared.start(target: .retrieverSession(id: s.id))
                SyncEngine.shared.start(interval: 20)
                TrackingResume.remember(taskId: nil, sessionId: s.id)
            }
        }
        startPolling()
        await poll()
    }

    func toggleDuty() async {
        do {
            if onDuty {
                _ = try await supa.rpc("end_retriever_duty", params: ["p_event": event.id]).execute()
                TrackingEngine.shared.stop()
                SyncEngine.shared.flushNow()
                TrackingResume.clear()
                onDuty = false
                session = nil
            } else {
                let s: RetrieverSession = try await supa
                    .rpc("start_retriever_duty", params: ["p_event": event.id])
                    .execute().value
                session = s
                onDuty = true
                TrackingEngine.shared.requestPermissions()
                TrackingEngine.shared.start(target: .retrieverSession(id: s.id))
                SyncEngine.shared.start(interval: 20)
                TrackingResume.remember(taskId: nil, sessionId: s.id)
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func updateVehicle(capacity: Int, description: String) async {
        struct P: Encodable {
            let p_event: UUID
            let p_capacity: Int
            let p_description: String
        }
        _ = try? await supa.rpc(
            "update_retriever_vehicle",
            params: P(p_event: event.id, p_capacity: capacity, p_description: description)
        ).execute()
        await poll()
    }

    func respond(_ request: RetrievalRequestRow, accept: Bool) async {
        struct P: Encodable {
            let p_request: UUID
            let p_accept: Bool
        }
        do {
            _ = try await supa
                .rpc("respond_retrieval", params: P(p_request: request.id, p_accept: accept))
                .execute()
            pendingRequest = nil
            await poll()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func advance(_ assignment: RetrievalAssignmentRow, action: String) async {
        struct P: Encodable {
            let p_assignment: UUID
            let p_action: String
        }
        do {
            _ = try await supa
                .rpc("advance_assignment", params: P(p_assignment: assignment.id, p_action: action))
                .execute()
            await poll()
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: polling

    private func startPolling() {
        guard pollTimer == nil else { return }
        pollTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { await self?.poll() }
        }
    }

    func poll() async {
        guard let userId = supa.auth.currentUser?.id else { return }

        profileRow = try? await supa.from("retriever_profiles")
            .select("availability, vehicle_capacity, occupied_seats, vehicle_description")
            .eq("event_id", value: event.id)
            .eq("user_id", value: userId)
            .single().execute().value

        let requests: [RetrievalRequestRow] = (try? await supa.from("retrieval_requests")
            .select()
            .eq("event_id", value: event.id)
            .eq("retriever_id", value: userId)
            .eq("status", value: "pending")
            .execute().value) ?? []
        pendingRequest = requests.first { $0.expiresAt > Date() }

        assignments = (try? await supa.from("retrieval_assignments")
            .select()
            .eq("event_id", value: event.id)
            .eq("retriever_id", value: userId)
            .in("status", values: ["assigned", "en_route", "picked_up", "delivered"])
            .order("created_at")
            .execute().value) ?? []

        await loadPilotDetails()
    }

    private func loadPilotDetails() async {
        var taskIds = assignments.map(\.taskId)
        var pilotIds = assignments.map(\.pilotId)
        if let req = pendingRequest {
            taskIds.append(req.taskId)
            pilotIds.append(req.pilotId)
        }
        guard !taskIds.isEmpty else {
            pilotPins = []
            return
        }

        struct NameRow: Codable {
            let id: UUID
            let displayName: String

            enum CodingKeys: String, CodingKey {
                case id
                case displayName = "display_name"
            }
        }
        let names: [NameRow] = (try? await supa.from("profiles")
            .select("id, display_name")
            .in("id", values: pilotIds)
            .execute().value) ?? []
        pilotNames = Dictionary(uniqueKeysWithValues: names.map { ($0.id, $0.displayName) })

        // Latest point per task — RLS grants exactly the tasks offered/assigned.
        struct PointRow: Codable {
            let taskId: UUID?
            let userId: UUID
            let geom: String

            enum CodingKeys: String, CodingKey {
                case geom
                case taskId = "task_id"
                case userId = "user_id"
            }
        }
        let points: [PointRow] = (try? await supa.from("location_points")
            .select("task_id, user_id, geom")
            .in("task_id", values: taskIds)
            .order("recorded_at", ascending: false)
            .limit(50)
            .execute().value) ?? []
        var pins: [UUID: PilotPin] = [:]
        for p in points {
            guard let taskId = p.taskId, pins[taskId] == nil,
                  let coord = parseWKBPoint(hex: p.geom) else { continue }
            pins[taskId] = PilotPin(
                id: taskId,
                name: pilotNames[p.userId] ?? "pilot",
                coordinate: coord
            )
        }
        pilotPins = Array(pins.values)
    }

    deinit {
        pollTimer?.invalidate()
    }
}

/// PostgREST serializes geography as hex EWKB; we only store 2-D points.
func parseWKBPoint(hex: String) -> CLLocationCoordinate2D? {
    guard hex.count >= 42, hex.count % 2 == 0 else { return nil }
    var bytes: [UInt8] = []
    bytes.reserveCapacity(hex.count / 2)
    var idx = hex.startIndex
    while idx < hex.endIndex {
        let next = hex.index(idx, offsetBy: 2)
        guard let byte = UInt8(hex[idx..<next], radix: 16) else { return nil }
        bytes.append(byte)
        idx = next
    }
    let littleEndian = bytes[0] == 1
    func u32(_ offset: Int) -> UInt32 {
        let slice = bytes[offset..<(offset + 4)]
        let value = slice.reduce(into: UInt32(0)) { $0 = ($0 << 8) | UInt32($1) }
        return littleEndian ? value.byteSwapped : value
    }
    func f64(_ offset: Int) -> Double {
        let slice = Array(bytes[offset..<(offset + 8)])
        let value = slice.reduce(into: UInt64(0)) { $0 = ($0 << 8) | UInt64($1) }
        return Double(bitPattern: littleEndian ? value.byteSwapped : value)
    }
    let type = u32(1)
    var offset = 5
    if type & 0x2000_0000 != 0 { offset += 4 }
    guard type & 0xFF == 1, bytes.count >= offset + 16 else { return nil }
    let lng = f64(offset)
    let lat = f64(offset + 8)
    guard abs(lat) <= 90, abs(lng) <= 180 else { return nil }
    return CLLocationCoordinate2D(latitude: lat, longitude: lng)
}
