import Foundation
import Testing
@testable import RetfastCore

/// Wires a store, a stub server and a sync engine.
struct SyncHarness {
    let store: LocalTelemetryStore
    let server = StubServer()
    let clock = TestClock()
    let api: APIClient
    let engine: TelemetrySyncEngine
    let tokens = InMemoryTokenStore("rt0")
    let refreshes = LockedBox(0)

    init(jitter: Double = 1, maxBatch: Int = 500) throws {
        store = try Fixtures.store()
        api = APIClient(baseURL: URL(string: "http://stub.local")!, session: server.makeSession(), tokenStore: tokens)
        engine = TelemetrySyncEngine(store: store, api: api, clock: clock,
                                     backoff: Backoff(base: 2, cap: 120, jitter: { jitter }),
                                     device: DeviceInfo(appVersion: "test", osVersion: "test"), maxBatchSize: maxBatch)
        let refreshes = self.refreshes
        server.on("POST", "/api/v1/auth/refresh") { _ in
            let n = refreshes.withLock { $0 += 1; return $0 }
            return .json(200, Fixtures.auth(access: "a\(n)", refresh: "rt\(n)"))
        }
        server.on("POST", "/api/v1/flights") { req in
            .json(201, ["id": req.json?["id"] as? String ?? "", "status": "recording"])
        }
    }

    /// Server that accepts every sample it gets.
    func acceptAll() {
        server.on("POST", "/api/v1/telemetry/batches") { req in .json(200, Self.ack(req)) }
    }

    static func ack(_ req: RecordedRequest, duplicate: Set<Int> = [], rejected: [Int: String] = [:]) -> [String: Any] {
        let json = req.json ?? [:]
        let seqs = (json["samples"] as? [[String: Any]] ?? []).compactMap { $0["seq"] as? Int }
        let acc = seqs.filter { !duplicate.contains($0) && rejected[$0] == nil }
        return ["batch_id": json["batch_id"] as? String ?? "", "accepted": acc,
                "duplicate": seqs.filter { duplicate.contains($0) },
                "rejected": rejected.map { ["seq": $0.key, "reason": $0.value] },
                "max_acked_seq": seqs.max() ?? 0, "server_time": "2026-11-04T10:00:00.000Z"]
    }

    @discardableResult
    func addFlight(samples: Int, serverCreated: Bool = false, state: FlightSessionState = .recording) throws -> LocalFlight {
        let f = Fixtures.flight(serverCreated: serverCreated, state: state)
        try store.insertFlight(f)
        for i in 0..<samples { try store.append(Fixtures.newSample(i), flightId: f.id) }
        return f
    }

    func batchIds() -> [String] {
        server.requests("POST", "/api/v1/telemetry/batches").compactMap { $0.json?["batch_id"] as? String }
    }
}

@Suite("Telemetry sync engine")
struct TelemetrySyncEngineTests {
    @Test func createsFlightThenUploadsInBatchesOf500() async throws {
        let h = try SyncHarness()
        h.acceptAll()
        let f = try h.addFlight(samples: 1200)
        var outcomes: [SyncOutcome] = []
        for _ in 0..<5 { outcomes.append(await h.engine.syncOnce()) }
        #expect(outcomes == [.progressed, .progressed, .progressed, .idle, .idle])
        let batches = h.server.requests("POST", "/api/v1/telemetry/batches")
        #expect(batches.map { ($0.json?["samples"] as? [Any])?.count ?? 0 } == [500, 500, 200])
        #expect(h.server.requests("POST", "/api/v1/flights").count == 1)
        #expect(h.server.requests.firstIndex { $0.path == "/api/v1/flights" }! < h.server.requests.firstIndex { $0.path == "/api/v1/telemetry/batches" }!)
        let first = try #require(batches.first?.json)
        #expect(first["flight_id"] as? String == f.id.uuidString.lowercased())
        let sample = try #require((first["samples"] as? [[String: Any]])?.first)
        #expect(sample["h_acc_m"] as? Double == 5)
        #expect((sample["meta"] as? [String: Any])?["profile"] as? String == "active_flight")
        #expect(try h.store.pendingCount() == 0)
        let snap = await h.engine.currentSnapshot
        #expect(snap.status == .synced)
        #expect(snap.lastServerAck != nil)
    }

    @Test func retriesSameBatchIdAfterServerError() async throws {
        let h = try SyncHarness()
        let calls = LockedBox(0)
        h.server.on("POST", "/api/v1/telemetry/batches") { req in
            let n = calls.withLock { $0 += 1; return $0 }
            return n == 1 ? .error(503, "unavailable") : .json(200, SyncHarness.ack(req))
        }
        try h.addFlight(samples: 10, serverCreated: true)
        #expect(await h.engine.syncOnce() == .failed(retryAfter: nil))
        #expect(await h.engine.currentSnapshot.status == .serverError("unavailable"))
        #expect(try h.store.pendingCount() == 10)
        // New samples arriving meanwhile must not change the retried batch.
        try h.store.append(Fixtures.newSample(10), flightId: try h.store.recentFlights().first!.id)
        #expect(await h.engine.syncOnce() == .progressed)
        let ids = h.batchIds()
        #expect(ids.count == 2 && ids[0] == ids[1])
        let bodies = h.server.requests("POST", "/api/v1/telemetry/batches").map { ($0.json?["samples"] as? [[String: Any]])?.compactMap { $0["seq"] as? Int } }
        #expect(bodies[0] == bodies[1])
        #expect(try h.store.pendingCount() == 1)
    }

    @Test func exponentialBackoffWithJitterUsesInjectedClock() async throws {
        let h = try SyncHarness(jitter: 1)
        h.server.on("POST", "/api/v1/telemetry/batches") { _ in .error(500, "internal") }
        try h.addFlight(samples: 3, serverCreated: true)
        await h.engine.runLoop(maxIterations: 5)
        #expect(h.clock.sleeps == [2, 4, 8, 16, 32])

        let h0 = try SyncHarness(jitter: 0)
        h0.server.on("POST", "/api/v1/telemetry/batches") { _ in .error(500, "internal") }
        try h0.addFlight(samples: 3, serverCreated: true)
        await h0.engine.runLoop(maxIterations: 3)
        #expect(h0.clock.sleeps == [1, 2, 4])  // equal jitter: never below half
    }

    @Test func honoursRetryAfterOn429() async throws {
        let h = try SyncHarness()
        h.server.on("POST", "/api/v1/telemetry/batches") { _ in .error(429, "rate_limited", headers: ["Retry-After": "7"]) }
        try h.addFlight(samples: 3, serverCreated: true)
        await h.engine.runLoop(maxIterations: 1)
        #expect(h.clock.sleeps == [7])
    }

    @Test func refreshesOn401ThenRetriesSameBatch() async throws {
        let h = try SyncHarness()
        // a1 is "expired" at the server; a2 works.
        h.server.on("POST", "/api/v1/telemetry/batches") { req in
            req.authorization == "Bearer a1" ? .error(401, "token_expired") : .json(200, SyncHarness.ack(req))
        }
        try h.addFlight(samples: 4, serverCreated: true)
        #expect(await h.engine.syncOnce() == .progressed)
        let ids = h.batchIds()
        #expect(ids.count == 2 && ids[0] == ids[1])
        #expect(h.server.requests("POST", "/api/v1/telemetry/batches").map(\.authorization) == ["Bearer a1", "Bearer a2"])
        // Rotated refresh token was used for the second refresh (no reuse).
        let refreshBodies = h.server.requests("POST", "/api/v1/auth/refresh").compactMap { $0.json?["refresh_token"] as? String }
        #expect(refreshBodies == ["rt0", "rt1"])
        #expect(try h.store.pendingCount() == 0)
    }

    @Test func duplicateIsSyncedRejectedIsNotRetried() async throws {
        let h = try SyncHarness()
        h.server.on("POST", "/api/v1/telemetry/batches") { req in
            .json(200, SyncHarness.ack(req, duplicate: [0, 1], rejected: [2: "timestamp_out_of_range"]))
        }
        let f = try h.addFlight(samples: 4, serverCreated: true)
        #expect(await h.engine.syncOnce() == .progressed)
        #expect(await h.engine.syncOnce() == .idle)
        let states = try h.store.samples(flightId: f.id).map(\.syncState)
        #expect(states == [.synced, .synced, .rejected, .synced])
        #expect(h.server.requests("POST", "/api/v1/telemetry/batches").count == 1)
        #expect(try h.store.syncCounts(flightId: f.id) == .init(pending: 0, synced: 3, rejected: 1))
    }

    @Test func offlineThenOnlineResumes() async throws {
        let h = try SyncHarness()
        let online = LockedBox(false)
        h.server.on("POST", "/api/v1/telemetry/batches") { req in
            guard online.withLock({ $0 }) else { throw StubFailure.offline }
            return .json(200, SyncHarness.ack(req))
        }
        try h.addFlight(samples: 5, serverCreated: true)
        #expect(await h.engine.syncOnce() == .offline)  // transport failure
        #expect(await h.engine.currentSnapshot.status == .offline)

        await h.engine.networkChanged(isConnected: false)
        let before = h.server.requests.count
        #expect(await h.engine.syncOnce() == .offline)
        #expect(h.server.requests.count == before)  // no traffic while the path is down

        online.withLock { $0 = true }
        await h.engine.networkChanged(isConnected: true)
        #expect(await h.engine.syncOnce() == .progressed)
        #expect(try h.store.pendingCount() == 0)
    }

    @Test func authRequiredWhenRefreshRefused() async throws {
        let h = try SyncHarness()
        h.server.on("POST", "/api/v1/auth/refresh") { _ in .error(401, "unauthorized") }
        h.acceptAll()
        try h.addFlight(samples: 2, serverCreated: true)
        #expect(await h.engine.syncOnce() == .authRequired)
        #expect(await h.engine.currentSnapshot.status == .authRequired)
        #expect(h.tokens.loadRefreshToken() == nil)
        let before = h.server.requests.count
        #expect(await h.engine.syncOnce() == .authRequired)
        #expect(h.server.requests.count == before)
        #expect(try h.store.pendingCount() == 2)  // nothing lost
    }

    @Test func endsFlightOnlyAfterAllSamplesAcknowledged() async throws {
        let h = try SyncHarness()
        h.acceptAll()
        h.server.on("POST", "/api/v1/flights/\(UUID().uuidString)/end") { _ in .error(500, "x") }
        let f = try h.addFlight(samples: 3, serverCreated: true, state: .completed)
        try h.store.updateFlight(id: f.id) { $0.endedAt = Fixtures.t0.addingTimeInterval(100) }
        let endPath = "/api/v1/flights/\(f.id.uuidString.lowercased())/end"
        h.server.on("POST", endPath) { _ in .json(200, ["id": f.id.uuidString.lowercased(), "status": "ended"]) }
        #expect(await h.engine.syncOnce() == .progressed)
        #expect(h.server.requests("POST", endPath).isEmpty)
        #expect(await h.engine.syncOnce() == .idle)
        #expect(h.server.requests("POST", endPath).count == 1)
        #expect(try h.store.flight(id: f.id)?.serverEnded == true)
    }
}

@Suite("API client")
struct APIClientTests {
    @Test func refreshIsSingleFlightAndRotates() async throws {
        let server = StubServer()
        let tokens = InMemoryTokenStore("rt0")
        let refreshes = LockedBox(0)
        let valid = LockedBox<String>("")
        server.on("POST", "/api/v1/auth/refresh") { _ in
            let n = refreshes.withLock { $0 += 1; return $0 }
            valid.withLock { $0 = "a\(n)" }
            var r = StubResponse.json(200, Fixtures.auth(access: "a\(n)", refresh: "rt\(n)"))
            r.delay = 0.2  // keep the refresh in flight while others pile up
            return r
        }
        server.on("GET", "/api/v1/me") { req in
            req.authorization == "Bearer \(valid.withLock { $0 })" ? .json(200, Fixtures.me()) : .error(401, "token_expired")
        }
        let api = APIClient(baseURL: URL(string: "http://stub.local")!, session: server.makeSession(), tokenStore: tokens)

        // 8 concurrent calls with no access token: exactly one refresh.
        try await withThrowingTaskGroup(of: Me.self) { group in
            for _ in 0..<8 { group.addTask { try await api.me() } }
            for try await me in group { #expect(me.id == "u1") }
        }
        #expect(await api.refreshCount == 1)

        // Server-side expiry: every in-flight request gets 401 token_expired → one more refresh.
        valid.withLock { $0 = "nobody" }
        try await withThrowingTaskGroup(of: Me.self) { group in
            for _ in 0..<8 { group.addTask { try await api.me() } }
            for try await me in group { #expect(me.id == "u1") }
        }
        #expect(await api.refreshCount == 2)
        let used = server.requests("POST", "/api/v1/auth/refresh").compactMap { $0.json?["refresh_token"] as? String }
        #expect(used == ["rt0", "rt1"])
        #expect(tokens.loadRefreshToken() == "rt2")
    }

    @Test func passwordChangeRequiredIsSurfaced() async throws {
        let server = StubServer()
        server.on("POST", "/api/v1/auth/login") { _ in .json(200, Fixtures.auth(access: "a", refresh: "r", mustChange: true)) }
        server.on("GET", "/api/v1/events") { _ in .error(403, "password_change_required") }
        let api = APIClient(baseURL: URL(string: "http://stub.local")!, session: server.makeSession(), tokenStore: InMemoryTokenStore())
        let me = try await api.login(email: "x@y.z", password: "p")
        #expect(me.mustChangePassword)
        await #expect(throws: APIError.self) { _ = try await api.events() }
        #expect(api.authEvents.latest == .passwordChangeRequired)
        let login = try #require(server.requests("POST", "/api/v1/auth/login").first?.json)
        #expect(login["client"] as? String == "ios")
    }

    @Test func decodesContractDates() throws {
        #expect(JSONCoding.parseDate("2026-11-04T12:00:00.123Z") != nil)
        #expect(JSONCoding.parseDate("2026-11-04T12:00:00Z") != nil)
        #expect(JSONCoding.formatDate(Date(timeIntervalSince1970: 0.5)) == "1970-01-01T00:00:00.500Z")
    }
}
