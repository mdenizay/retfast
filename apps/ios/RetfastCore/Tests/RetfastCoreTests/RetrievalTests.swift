import Foundation
import Testing
@testable import RetfastCore

enum RetrievalFixtures {
    static let eventId = "11111111-2222-3333-4444-555555555555"
    static let pickup = SharedPosition(lat: 37.071, lon: 29.341, gpsAltM: 950, hAccM: 6, t: Fixtures.t0)

    static func json(id: String, status: String, retrieverId: String? = nil, retrieverName: String = "Kübra",
                     pilotId: String = "u1", requestedAt: String = "2026-11-05T10:00:00.000Z") -> [String: Any] {
        var r: [String: Any] = [
            "id": id, "event_id": eventId, "flight_id": NSNull(), "status": status,
            "pilot": ["user_id": pilotId, "full_name": "Deniz", "public_id": "deniz", "phone": ""],
            "pickup": ["lat": 37.071, "lon": 29.341, "gps_alt_m": 950, "h_acc_m": 6, "t": "2026-11-05T10:00:00.000Z"],
            "pilot_position": NSNull(), "note": "Yol kenarındayım",
            "retriever": NSNull(), "retriever_position": NSNull(),
            "requested_at": requestedAt, "accepted_at": NSNull(), "picked_up_at": NSNull(),
            "delivered_at": NSNull(), "cancelled_at": NSNull(), "cancelled_by": NSNull(),
            "cancel_reason": "", "delivery_note": "", "is_simulated": false, "updates": [],
        ]
        if let retrieverId {
            r["retriever"] = ["user_id": retrieverId, "full_name": retrieverName, "phone": "+90 555 000 00 00"]
            r["retriever_position"] = ["lat": 37.05, "lon": 29.30, "h_acc_m": 8, "t": "2026-11-05T10:05:00.000Z"]
            r["accepted_at"] = "2026-11-05T10:02:00.000Z"
        }
        return r
    }
}

/// Store + stub server + manager.
struct RetrievalHarness {
    let store: LocalTelemetryStore
    let server = StubServer()
    let clock = TestClock()
    let api: APIClient
    let manager: RetrievalManager

    init(store: LocalTelemetryStore? = nil) throws {
        self.store = try store ?? Fixtures.store()
        api = APIClient(baseURL: URL(string: "http://stub.local")!, session: server.makeSession(), tokenStore: InMemoryTokenStore("rt0"))
        manager = RetrievalManager(store: self.store, api: api, clock: clock,
                                   backoff: Backoff(base: 2, cap: 60, jitter: { 1 }), pollInterval: 15)
        server.on("POST", "/api/v1/auth/refresh") { _ in .json(200, Fixtures.auth(access: "a1", refresh: "rt1")) }
    }

    var createPath: String { "/api/v1/events/\(RetrievalFixtures.eventId)/retrievals" }

    func createRequests() -> [RecordedRequest] { server.requests("POST", createPath) }

    func request(note: String = "Yol kenarındayım") async throws -> LocalRetrieval {
        try await manager.request(eventId: RetrievalFixtures.eventId, eventName: "Çameli", flightId: nil,
                                  pickup: RetrievalFixtures.pickup, note: note, startDelivery: false)
    }
}

@Suite("Retrieval request outbox")
struct RetrievalOutboxTests {
    @Test func persistsBeforeAnyNetwork() async throws {
        let h = try RetrievalHarness()
        let r = try await h.request()
        #expect(h.server.requests.isEmpty)
        let saved = try #require(try h.store.retrieval(id: r.id))
        #expect(saved.outbox == .pending)
        #expect(saved.stage == .savedLocally)
        #expect(saved.pickupLat == 37.071 && saved.pickupHAcc == 6)
        #expect(saved.note == "Yol kenarındayım")
        #expect(await h.manager.activeRetrieval()?.id == r.id)
    }

    @Test func sendsWithClientIdThenPolls() async throws {
        let h = try RetrievalHarness()
        let r = try await h.request()
        h.server.on("POST", h.createPath) { req in .json(201, RetrievalFixtures.json(id: req.json?["id"] as! String, status: "requested")) }
        h.server.on("GET", "/api/v1/retrievals/\(r.wireId)") { _ in
            .json(200, RetrievalFixtures.json(id: r.wireId, status: "accepted", retrieverId: "u5"))
        }
        let delay = await h.manager.step(r.id)
        #expect(delay == 15)
        let body = try #require(h.createRequests().first?.json)
        #expect(body["id"] as? String == r.wireId)
        #expect(body["note"] as? String == "Yol kenarındayım")
        let pickup = try #require(body["pickup"] as? [String: Any])
        #expect(pickup["lat"] as? Double == 37.071)
        #expect(pickup["h_acc_m"] as? Double == 6)
        #expect(pickup["t"] as? String == "2027-01-15T08:00:00.000Z")
        var saved = try #require(try h.store.retrieval(id: r.id))
        #expect(saved.outbox == .sent)
        #expect(saved.stage == .requested)

        // Next step polls and picks up the acceptance.
        #expect(await h.manager.step(r.id) == 15)
        saved = try #require(try h.store.retrieval(id: r.id))
        #expect(saved.stage == .accepted)
        #expect(saved.server?.retriever?.fullName == "Kübra")
        #expect(saved.server?.retriever?.phone == "+90 555 000 00 00")
    }

    @Test func retriesWithTheSameIdAfterFailures() async throws {
        let h = try RetrievalHarness()
        let r = try await h.request()
        let calls = LockedBox(0)
        h.server.on("POST", h.createPath) { req in
            let n = calls.withLock { $0 += 1; return $0 }
            if n == 1 { throw StubFailure.offline }
            if n == 2 { return .error(503, "unavailable") }
            return .json(200, RetrievalFixtures.json(id: req.json?["id"] as! String, status: "requested"))
        }
        let d1 = await h.manager.step(r.id)
        #expect(d1 == 2)  // backoff 2·2^0 with jitter 1
        #expect(try h.store.retrieval(id: r.id)?.stage == .sending)
        #expect(try h.store.retrieval(id: r.id)?.lastError == "offline")
        let d2 = await h.manager.step(r.id)
        #expect(d2 == 4)
        #expect(await h.manager.step(r.id) == 15)
        let ids = h.createRequests().compactMap { $0.json?["id"] as? String }
        #expect(ids == [r.wireId, r.wireId, r.wireId])
        let saved = try #require(try h.store.retrieval(id: r.id))
        #expect(saved.outbox == .sent && saved.attemptCount == 3 && saved.lastError == nil)
    }

    @Test func survivesRelaunchAndResumes() async throws {
        let url = Fixtures.tempURL()
        var id: UUID?
        do {
            let h = try RetrievalHarness(store: try LocalTelemetryStore.open(at: url))
            id = try await h.request().id
        } // process dies before any send
        let h = try RetrievalHarness(store: try LocalTelemetryStore.open(at: url))
        h.server.on("POST", h.createPath) { req in .json(201, RetrievalFixtures.json(id: req.json?["id"] as! String, status: "requested")) }
        let restored = try #require(await h.manager.activeRetrieval())
        #expect(restored.id == id)
        #expect(await h.manager.step(restored.id) == 15)
        #expect(try h.store.retrieval(id: restored.id)?.stage == .requested)
    }

    @Test func conflictAdoptsTheOpenRequestFromDetails() async throws {
        let h = try RetrievalHarness()
        let r = try await h.request()
        let other = "99999999-8888-7777-6666-555555555555"
        h.server.on("POST", h.createPath) { _ in
            .json(409, ["error": ["code": "conflict", "message": "open retrieval exists",
                                  "details": ["retrieval": RetrievalFixtures.json(id: other, status: "accepted", retrieverId: "u5")]]])
        }
        #expect(await h.manager.step(r.id) == nil)
        let local = try #require(try h.store.retrieval(id: r.id))
        #expect(local.outbox == .merged && local.mergedInto == other)
        #expect(local.stage == .merged && local.isTerminal)
        let adopted = try #require(await h.manager.activeRetrieval())
        #expect(adopted.wireId == other)
        #expect(adopted.outbox == .sent && adopted.stage == .accepted)
    }

    @Test func conflictWithoutDetailsFallsBackToTheOpenList() async throws {
        let h = try RetrievalHarness()
        let r = try await h.request()
        h.server.on("POST", h.createPath) { _ in .error(409, "conflict") }
        h.server.on("GET", h.createPath) { req in
            #expect(req.query == "status=requested,accepted,picked_up")
            return .json(200, ["items": [RetrievalFixtures.json(id: r.wireId, status: "requested")], "next_cursor": NSNull()])
        }
        // Our own id came back: the first response was lost; it is ours.
        #expect(await h.manager.step(r.id) == 15)
        #expect(try h.store.retrieval(id: r.id)?.outbox == .sent)
    }

    @Test func refusedIsPermanent() async throws {
        let h = try RetrievalHarness()
        let r = try await h.request()
        h.server.on("POST", h.createPath) { _ in .error(403, "forbidden") }
        #expect(await h.manager.step(r.id) == nil)
        let saved = try #require(try h.store.retrieval(id: r.id))
        #expect(saved.stage == .refused && saved.lastError == "forbidden")
        #expect(await h.manager.activeRetrieval() == nil)
    }

    @Test func cancelBeforeAnyAttemptStaysLocal() async throws {
        let h = try RetrievalHarness()
        let r = try await h.request()
        try await h.manager.cancel(id: r.id, reason: "kendim döndüm", startDelivery: false)
        #expect(await h.manager.step(r.id) == nil)
        #expect(h.server.requests.isEmpty)
        #expect(try h.store.retrieval(id: r.id)?.stage == .cancelled)
    }

    @Test func cancelAfterSendIsDeliveredToTheServer() async throws {
        let h = try RetrievalHarness()
        let r = try await h.request()
        h.server.on("POST", h.createPath) { req in .json(201, RetrievalFixtures.json(id: req.json?["id"] as! String, status: "requested")) }
        h.server.on("POST", "/api/v1/retrievals/\(r.wireId)/cancel") { _ in
            .json(200, RetrievalFixtures.json(id: r.wireId, status: "cancelled"))
        }
        _ = await h.manager.step(r.id)
        try await h.manager.cancel(id: r.id, reason: "kendim döndüm", startDelivery: false)
        #expect(try h.store.retrieval(id: r.id)?.stage == .cancelling)
        #expect(await h.manager.step(r.id) == nil)
        let cancel = try #require(h.server.requests("POST", "/api/v1/retrievals/\(r.wireId)/cancel").first?.json)
        #expect(cancel["reason"] as? String == "kendim döndüm")
        #expect(try h.store.retrieval(id: r.id)?.stage == .cancelled)
    }

    @Test func cancelDuringAnInFlightCreateIsNotLost() async throws {
        let h = try RetrievalHarness()
        let r = try await h.request()
        h.server.on("POST", h.createPath) { req in
            var resp = StubResponse.json(201, RetrievalFixtures.json(id: req.json?["id"] as! String, status: "requested"))
            resp.delay = 0.3
            return resp
        }
        h.server.on("POST", "/api/v1/retrievals/\(r.wireId)/cancel") { _ in .json(200, RetrievalFixtures.json(id: r.wireId, status: "cancelled")) }
        let manager = h.manager
        let inFlight = Task { await manager.step(r.id) }
        try await Task.sleep(nanoseconds: 100_000_000)
        try await manager.cancel(id: r.id, reason: nil, startDelivery: false)
        // The create response must not overwrite the cancel request.
        #expect(await inFlight.value == 0)
        #expect(try h.store.retrieval(id: r.id)?.cancelRequested == true)
        #expect(await manager.step(r.id) == nil)
        #expect(try h.store.retrieval(id: r.id)?.stage == .cancelled)
    }

    @Test func realtimeUpdateIsApplied() async throws {
        let h = try RetrievalHarness()
        let r = try await h.request()
        let decoded = try JSONCoding.makeDecoder().decode(Retrieval.self, from: JSONSerialization.data(
            withJSONObject: RetrievalFixtures.json(id: r.wireId, status: "picked_up", retrieverId: "u5")))
        await h.manager.apply(decoded)
        let saved = try #require(try h.store.retrieval(id: r.id))
        #expect(saved.stage == .pickedUp)
        #expect(!saved.stage.sharesPilotPosition)
    }
}

@Suite("Retrieval stage mapping")
struct RetrievalStageTests {
    func make(_ outbox: RetrievalOutboxState, status: String? = nil, attempts: Int = 0,
              cancelRequested: Bool = false, cancelSynced: Bool = false) -> LocalRetrieval {
        var r = LocalRetrieval(eventId: "e", eventName: nil, flightId: nil, pickup: RetrievalFixtures.pickup, note: "", createdAt: Fixtures.t0)
        r.outbox = outbox; r.serverStatus = status; r.attemptCount = attempts
        r.cancelRequested = cancelRequested; r.cancelSynced = cancelSynced
        return r
    }

    @Test func mapsEveryState() {
        #expect(make(.pending).stage == .savedLocally)
        #expect(make(.pending, attempts: 2).stage == .sending)
        #expect(make(.sent, status: "requested").stage == .requested)
        #expect(make(.sent, status: nil).stage == .requested)
        #expect(make(.sent, status: "accepted").stage == .accepted)
        #expect(make(.sent, status: "picked_up").stage == .pickedUp)
        #expect(make(.sent, status: "delivered").stage == .delivered)
        #expect(make(.sent, status: "cancelled").stage == .cancelled)
        #expect(make(.sent, status: "accepted", cancelRequested: true).stage == .cancelling)
        #expect(make(.pending, attempts: 1, cancelRequested: true).stage == .cancelling)
        #expect(make(.pending, cancelRequested: true, cancelSynced: true).stage == .cancelled)
        #expect(make(.refused, attempts: 1).stage == .refused)
        #expect(make(.merged).stage == .merged)
    }

    @Test func ladderAndSharingRules() {
        #expect(RetrievalStage.savedLocally.confirmedStep == nil)
        #expect(RetrievalStage.sending.confirmedStep == nil)
        #expect(RetrievalStage.requested.confirmedStep == 0)
        #expect(RetrievalStage.accepted.confirmedStep == 1)
        #expect(RetrievalStage.pickedUp.confirmedStep == 2)
        #expect(RetrievalStage.delivered.confirmedStep == 3)
        #expect(RetrievalStage.requested.sharesPilotPosition)
        #expect(RetrievalStage.accepted.sharesPilotPosition)
        for s in [RetrievalStage.savedLocally, .sending, .pickedUp, .delivered, .cancelling, .cancelled, .refused, .merged] {
            #expect(!s.sharesPilotPosition)
        }
    }

    @Test func terminalStates() {
        #expect(!make(.pending).isTerminal)
        #expect(!make(.sent, status: "accepted").isTerminal)
        #expect(make(.sent, status: "delivered").isTerminal)
        #expect(make(.sent, status: "cancelled").isTerminal)
        #expect(!make(.sent, status: "requested", cancelRequested: true).isTerminal)
        #expect(make(.refused).isTerminal)
    }
}

@Suite("Contract decoding")
struct ContractDecodingTests {
    @Test func liveSnapshotWithRetrievalsAndRetrievers() throws {
        let json: [String: Any] = [
            "event_id": RetrievalFixtures.eventId, "server_time": "2026-11-05T10:06:00.000Z", "cursor": "1-0",
            "pilots": [],
            "retrievals": [RetrievalFixtures.json(id: "r1", status: "accepted", retrieverId: "u5")],
            "retrievers": [["user_id": "u5", "full_name": "Kübra", "on_duty": true,
                            "position": ["lat": 37.05, "lon": 29.3, "h_acc_m": 8, "t": "2026-11-05T10:05:00.000Z"],
                            "age_s": 12.5, "active_retrievals": 1]],
        ]
        let s = try JSONCoding.makeDecoder().decode(LiveSnapshot.self, from: JSONSerialization.data(withJSONObject: json))
        #expect(s.retrievals?.first?.retrievalStatus == .accepted)
        #expect(s.retrievals?.first?.retrieverPosition?.lat == 37.05)
        #expect(s.retrievers?.first?.onDuty == true)
        // Retrievers get no general pilots list: a missing key decodes as empty.
        let bare = try JSONCoding.makeDecoder().decode(LiveSnapshot.self, from: Data(#"{"event_id":"e"}"#.utf8))
        #expect(bare.pilots.isEmpty)
    }

    @Test func eventWithMembershipBlock() throws {
        let json = #"""
        {"id":"e1","slug":"cameli","name":"Çameli","status":"active","settings":{"applications_open":true,"live_tracking":true,
         "public_live_map":false,"pilots_see_each_other":true,"landing_prompt":true},
         "organizers":[{"user_id":"u1","full_name":"Deniz"}],"counts":{"pilots":3,"observers":1,"retrievers":1,"pending_applications":2},
         "me":{"is_organizer":true,"role":"pilot","application":null}}
        """#
        let e = try JSONCoding.makeDecoder().decode(Event.self, from: Data(json.utf8))
        #expect(e.memberRole == .pilot && e.isOrganizer)
        #expect(e.settings?.landingPrompt == true)
        #expect(e.counts?.pendingApplications == 2)
        #expect(e.organizers?.first?.fullName == "Deniz")
    }

    @Test func errorDetailsMayContainObjects() throws {
        let json = #"{"error":{"code":"conflict","message":"x","details":{"retrieval":{"id":"r1","status":"requested"},"n":3}}}"#
        let body = try JSONCoding.makeDecoder().decode(APIErrorBody.self, from: Data(json.utf8))
        #expect(body.error.code == "conflict")
        #expect(body.error.details?["n"] == "3")
        let inner = try #require(body.error.details?["retrieval"])
        #expect(try JSONCoding.makeDecoder().decode(Retrieval.self, from: Data(inner.utf8)).id == "r1")
    }
}

@Suite("Applications")
struct ApplicationTests {
    @Test func applySendsNoRoleAndApproveSendsTheOrganizersChoice() async throws {
        let server = StubServer()
        let api = APIClient(baseURL: URL(string: "http://stub.local")!, session: server.makeSession(), tokenStore: InMemoryTokenStore("rt0"))
        server.on("POST", "/api/v1/auth/refresh") { _ in .json(200, Fixtures.auth(access: "a1", refresh: "rt1")) }
        server.on("POST", "/api/v1/events/e1/applications") { _ in .json(201, ["id": "a1", "status": "pending", "message": "Pilot olarak uçacağım"]) }
        server.on("POST", "/api/v1/events/e1/applications/a1/approve") { _ in .json(200, ["id": "a1", "status": "approved", "granted_role": "retriever"]) }
        let app = try await api.apply(eventId: "e1", message: "Pilot olarak uçacağım")
        #expect(app?.status == "pending")
        let body = try #require(server.requests("POST", "/api/v1/events/e1/applications").first?.json)
        #expect(Set(body.keys) == ["message"])
        try await api.approveApplication(eventId: "e1", applicationId: "a1", role: .retriever, note: nil)
        let approve = try #require(server.requests("POST", "/api/v1/events/e1/applications/a1/approve").first?.json)
        #expect(approve["role"] as? String == "retriever")
    }
}
