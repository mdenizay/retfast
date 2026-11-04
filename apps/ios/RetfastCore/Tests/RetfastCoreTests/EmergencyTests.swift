import Foundation
import Testing
@testable import RetfastCore

@Suite("Emergency manager state ladder")
struct EmergencyManagerTests {
    struct Harness {
        let store: LocalTelemetryStore
        let server = StubServer()
        let clock = TestClock()
        let api: APIClient
        let manager: EmergencyManager

        init() throws {
            store = try Fixtures.store()
            api = APIClient(baseURL: URL(string: "http://stub.local")!, session: server.makeSession(), tokenStore: InMemoryTokenStore("rt"))
            manager = EmergencyManager(store: store, api: api, clock: clock, backoff: Backoff(base: 2, cap: 30, jitter: { 1 }))
            server.on("POST", "/api/v1/auth/refresh") { _ in .json(200, Fixtures.auth(access: "a", refresh: "rt2")) }
        }

        static func incident(_ id: String, status: String = "open", ack: Bool = false) -> [String: Any] {
            var o: [String: Any] = ["id": id, "kind": "sos", "is_test": false, "status": status,
                                    "received_at": "2026-11-04T10:00:01.000Z", "created_at_device": "2026-11-04T10:00:00.000Z"]
            if ack {
                o["acknowledged_at"] = "2026-11-04T10:02:00.000Z"
                o["acknowledged_by"] = ["user_id": "r1", "full_name": "Rescue One"]
            }
            return o
        }
    }

    let position = IncidentPosition(lat: 37.1, lon: 29.3, gpsAltM: 1800, hAccM: 6, t: Fixtures.t0)

    @Test func fullLadder() async throws {
        let h = try Harness()
        let inc = try await h.manager.trigger(position: position, flightId: nil, eventId: nil, isTest: false, startDelivery: false)
        // Persisted locally before any network use.
        #expect(try h.store.incident(id: inc.id)?.deliveryState == .createdLocally)
        #expect(h.server.requests.isEmpty)
        #expect(h.manager.activeEmergency.latest == true)
        let wire = inc.id.uuidString.lowercased()

        // 1. No network: stays pending_transmission, retried with backoff.
        h.server.on("POST", "/api/v1/incidents") { _ in throw StubFailure.offline }
        #expect(await h.manager.step(inc.id) == 2)
        #expect(try h.store.incident(id: inc.id)?.deliveryState == .pendingTransmission)
        #expect(await h.manager.step(inc.id) == 4)
        #expect(try h.store.incident(id: inc.id)?.attemptCount == 2)

        // 2. Delivered: received_by_server, then poll every 10 s.
        h.server.on("POST", "/api/v1/incidents") { _ in .json(201, Harness.incident(wire)) }
        #expect(await h.manager.step(inc.id) == 10)
        #expect(try h.store.incident(id: inc.id)?.deliveryState == .receivedByServer)
        let body = try #require(h.server.requests("POST", "/api/v1/incidents").last?.json)
        #expect(body["id"] as? String == wire)
        #expect((body["position"] as? [String: Any])?["lat"] as? Double == 37.1)

        // 3. Polled, nobody has acknowledged: still received_by_server.
        let acked = LockedBox(false)
        h.server.on("GET", "/api/v1/incidents/\(wire)") { _ in .json(200, Harness.incident(wire, ack: acked.withLock { $0 })) }
        #expect(await h.manager.step(inc.id) == 10)
        #expect(try h.store.incident(id: inc.id)?.deliveryState == .receivedByServer)

        // 4. Acknowledged by a responder.
        acked.withLock { $0 = true }
        #expect(await h.manager.step(inc.id) == 10)
        let a = try #require(try h.store.incident(id: inc.id))
        #expect(a.deliveryState == .acknowledged)
        #expect(a.acknowledgedByName == "Rescue One")

        // Never moves backwards even if a stale response says otherwise.
        acked.withLock { $0 = false }
        h.server.on("GET", "/api/v1/incidents/\(wire)") { _ in .json(200, Harness.incident(wire, status: "open")) }
        _ = await h.manager.step(inc.id)
        #expect(try h.store.incident(id: inc.id)?.deliveryState == .acknowledged)

        // 5. Resolved: polling stops.
        h.server.on("GET", "/api/v1/incidents/\(wire)") { _ in .json(200, Harness.incident(wire, status: "resolved", ack: true)) }
        #expect(await h.manager.step(inc.id) == nil)
        #expect(try h.store.incident(id: inc.id)?.deliveryState == .resolved)
    }

    @Test func cancelBeforeTransmissionStaysLocal() async throws {
        let h = try Harness()
        let inc = try await h.manager.trigger(position: nil, flightId: nil, eventId: nil, isTest: false, startDelivery: false)
        try await h.manager.cancel(id: inc.id, startDelivery: false)
        #expect(try h.store.incident(id: inc.id)?.deliveryState == .cancelled)
        #expect(await h.manager.step(inc.id) == nil)
        #expect(h.server.requests.isEmpty)
        #expect(h.manager.activeEmergency.latest == false)
    }

    @Test func cancelAfterReceiptIsSentToServer() async throws {
        let h = try Harness()
        let inc = try await h.manager.trigger(position: position, flightId: nil, eventId: nil, isTest: false, startDelivery: false)
        let wire = inc.id.uuidString.lowercased()
        h.server.on("POST", "/api/v1/incidents") { _ in .json(201, Harness.incident(wire)) }
        h.server.on("POST", "/api/v1/incidents/\(wire)/cancel") { _ in .json(200, Harness.incident(wire, status: "cancelled")) }
        _ = await h.manager.step(inc.id)
        try await h.manager.cancel(id: inc.id, startDelivery: false)
        #expect(try h.store.incident(id: inc.id)?.deliveryState == .receivedByServer)  // not cancelled until server says so
        #expect(await h.manager.step(inc.id) == nil)
        #expect(h.server.requests("POST", "/api/v1/incidents/\(wire)/cancel").count == 1)
        #expect(try h.store.incident(id: inc.id)?.deliveryState == .cancelled)
    }

    @Test func cancelWhileUnconfirmedStillDeliversThenCancels() async throws {
        let h = try Harness()
        let inc = try await h.manager.trigger(position: position, flightId: nil, eventId: nil, isTest: false, startDelivery: false)
        let wire = inc.id.uuidString.lowercased()
        h.server.on("POST", "/api/v1/incidents") { _ in throw StubFailure.offline }
        _ = await h.manager.step(inc.id)  // attempted, outcome unknown to the server
        try await h.manager.cancel(id: inc.id, startDelivery: false)
        h.server.on("POST", "/api/v1/incidents") { _ in .json(201, Harness.incident(wire)) }
        h.server.on("POST", "/api/v1/incidents/\(wire)/cancel") { _ in .json(200, Harness.incident(wire, status: "cancelled")) }
        #expect(await h.manager.step(inc.id) == 0)
        #expect(await h.manager.step(inc.id) == nil)
        #expect(try h.store.incident(id: inc.id)?.deliveryState == .cancelled)
    }

    @Test func refusedTestSOS() async throws {
        let h = try Harness()
        let inc = try await h.manager.trigger(position: position, flightId: nil, eventId: nil, isTest: true, startDelivery: false)
        h.server.on("POST", "/api/v1/incidents") { _ in .error(403, "forbidden") }
        #expect(await h.manager.step(inc.id) == nil)
        let saved = try #require(try h.store.incident(id: inc.id))
        #expect(saved.deliveryState == .refused)
        #expect(saved.lastError == "forbidden")
        #expect(h.server.requests("POST", "/api/v1/incidents").first?.json?["is_test"] as? Bool == true)
    }

    @Test func resumesUnfinishedAfterRelaunch() async throws {
        let h = try Harness()
        let inc = try await h.manager.trigger(position: position, flightId: nil, eventId: nil, isTest: false, startDelivery: false)
        let wire = inc.id.uuidString.lowercased()
        h.server.on("POST", "/api/v1/incidents") { _ in .json(201, Harness.incident(wire, ack: true)) }
        let relaunched = EmergencyManager(store: h.store, api: h.api, clock: h.clock)
        await relaunched.run(inc.id, maxSteps: 1)
        #expect(try h.store.incident(id: inc.id)?.deliveryState == .acknowledged)
    }

    @Test func ladderOrder() {
        let order: [SOSDeliveryState] = [.createdLocally, .pendingTransmission, .receivedByServer, .acknowledged, .resolved]
        #expect(order.map(\.rank) == order.map(\.rank).sorted())
        #expect(!SOSDeliveryState.acknowledged.isTerminal)
        #expect(SOSDeliveryState.cancelled.isTerminal)
    }
}
