import Foundation
import Testing
@testable import RetfastCore

@MainActor
func waitUntil(_ timeout: Double = 2, _ condition: @MainActor () -> Bool) async {
    let deadline = Date().addingTimeInterval(timeout)
    while !condition() && Date() < deadline {
        try? await Task.sleep(nanoseconds: 5_000_000)
    }
}

@Suite("Position sharing")
@MainActor
struct PositionSharingTests {
    func retrieval(_ outbox: RetrievalOutboxState, _ status: String?) -> LocalRetrieval {
        var r = LocalRetrieval(eventId: "e1", eventName: nil, flightId: nil, pickup: RetrievalFixtures.pickup, note: "", createdAt: Fixtures.t0)
        r.outbox = outbox
        r.serverStatus = status
        return r
    }

    @Test func modePerRetrievalState() {
        #expect(SharingMode.decide(activeRetrieval: nil, duty: nil) == .off)
        // Not yet known to the server: nothing to post positions to.
        #expect(SharingMode.decide(activeRetrieval: retrieval(.pending, nil), duty: nil) == .off)
        let requested = retrieval(.sent, "requested")
        #expect(SharingMode.decide(activeRetrieval: requested, duty: nil) == .pilotWaiting(retrievalId: requested.wireId, eventId: "e1"))
        let accepted = retrieval(.sent, "accepted")
        #expect(SharingMode.decide(activeRetrieval: accepted, duty: nil) == .pilotWaiting(retrievalId: accepted.wireId, eventId: "e1"))
        // Stop at picked_up / delivered / cancelled.
        for status in ["picked_up", "delivered", "cancelled"] {
            #expect(SharingMode.decide(activeRetrieval: retrieval(.sent, status), duty: nil) == .off)
        }
        #expect(SharingMode.decide(activeRetrieval: retrieval(.refused, nil), duty: nil) == .off)
        #expect(SharingMode.pilotWaiting(retrievalId: "r", eventId: "e").profile == .retrieveWaiting)
        #expect(SharingMode.pilotWaiting(retrievalId: "r", eventId: "e").interval == 30)
    }

    @Test func modePerRetrieverDuty() {
        let off = RetrieverDutyState(eventId: "e2", eventName: nil, onDuty: false, activePickups: 0)
        let on = RetrieverDutyState(eventId: "e2", eventName: nil, onDuty: true, activePickups: 0)
        let holding = RetrieverDutyState(eventId: "e2", eventName: nil, onDuty: false, activePickups: 2)
        #expect(SharingMode.decide(activeRetrieval: nil, duty: off) == .off)
        #expect(SharingMode.decide(activeRetrieval: nil, duty: on) == .retriever(eventId: "e2"))
        #expect(SharingMode.decide(activeRetrieval: nil, duty: holding) == .retriever(eventId: "e2"))
        #expect(SharingMode.retriever(eventId: "e2").profile == .retrieverDriving)
        #expect(SharingMode.retriever(eventId: "e2").interval == 15)
        // A stranded pilot wins over duty in another event.
        let waiting = retrieval(.sent, "requested")
        #expect(SharingMode.decide(activeRetrieval: waiting, duty: on) == .pilotWaiting(retrievalId: waiting.wireId, eventId: "e1"))
    }

    @Test func dueRules() {
        let t = Fixtures.t0
        #expect(!SharingMode.isDue(now: t, lastSentAt: nil, lastSentFixAt: nil, latestFixAt: nil, interval: 30))
        #expect(SharingMode.isDue(now: t, lastSentAt: nil, lastSentFixAt: nil, latestFixAt: t, interval: 30))
        #expect(!SharingMode.isDue(now: t.addingTimeInterval(10), lastSentAt: t, lastSentFixAt: t, latestFixAt: t.addingTimeInterval(9), interval: 30))
        #expect(SharingMode.isDue(now: t.addingTimeInterval(30), lastSentAt: t, lastSentFixAt: t, latestFixAt: t.addingTimeInterval(29), interval: 30))
        // Same fix is never re-sent.
        #expect(!SharingMode.isDue(now: t.addingTimeInterval(300), lastSentAt: t, lastSentFixAt: t, latestFixAt: t, interval: 30))
    }

    @Test func managerStartsSendsThrottlesAndStops() async throws {
        let engine = FakeLocation()
        let arbiter = LocationArbiter(engine: engine)
        let sent = LockedBox<[(SharingMode, SharedPosition)]>([])
        final class Clock { var now = Fixtures.t0 }
        let clock = Clock()
        let m = PositionSharingManager(location: arbiter.client(.sharing), sender: { mode, p in
            sent.withLock { $0.append((mode, p)) }
        }, tickInterval: 3600, now: { clock.now })

        let mode = SharingMode.pilotWaiting(retrievalId: "r1", eventId: "e1")
        m.update(mode: mode)
        #expect(engine.started == [.retrieveWaiting])

        engine.deliver([Fixtures.fix(0, hAcc: 7)])
        await waitUntil { m.sentCount == 1 }
        #expect(m.sentCount == 1)
        let first = try #require(sent.withLock { $0.first })
        #expect(first.0 == mode)
        #expect(first.1.hAccM == 7 && first.1.t == Fixtures.t0)

        clock.now = Fixtures.t0.addingTimeInterval(10)
        engine.deliver([Fixtures.fix(10)])
        await Task.yield()
        #expect(m.sentCount == 1)  // throttled to ≈ 30 s

        clock.now = Fixtures.t0.addingTimeInterval(31)
        engine.deliver([Fixtures.fix(31)])
        await waitUntil { m.sentCount == 2 }
        #expect(m.sentCount == 2)

        // Picked up → stop sharing and GPS.
        m.update(mode: .off)
        #expect(engine.stops == 1)
        engine.deliver([Fixtures.fix(90)])
        await Task.yield()
        #expect(m.sentCount == 2)
    }

    @Test func targetGoneIsReported() async throws {
        let engine = FakeLocation()
        let arbiter = LocationArbiter(engine: engine)
        let m = PositionSharingManager(location: arbiter.client(.sharing), sender: { _, _ in
            throw APIError.server(status: 409, code: "conflict", message: nil, details: nil, retryAfter: nil)
        }, tickInterval: 3600)
        var gone: SharingMode?
        m.onTargetGone = { gone = $0 }
        m.update(mode: .retriever(eventId: "e2"))
        #expect(engine.started == [.retrieverDriving])
        engine.deliver([Fixtures.fix(0)])
        await waitUntil { gone != nil }
        #expect(gone == .retriever(eventId: "e2"))
        #expect(m.lastError == "conflict" && m.failureCount == 1)
    }
}

@Suite("Location arbiter")
@MainActor
struct LocationArbiterTests {
    @Test func flightTakesPrecedenceAndSharingSurvivesFlightEnd() throws {
        let engine = FakeLocation()
        let arbiter = LocationArbiter(engine: engine)
        let flight = arbiter.client(.flight)
        let sharing = arbiter.client(.sharing)
        var flightFixes = 0, sharingFixes = 0
        flight.onLocations = { flightFixes += $0.count }
        sharing.onLocations = { sharingFixes += $0.count }

        sharing.startRecording(profile: .retrieveWaiting)
        #expect(engine.started == [.retrieveWaiting])
        flight.startRecording(profile: .preFlight)
        #expect(engine.applied.last == .preFlight)
        #expect(arbiter.effectiveProfile == .preFlight)
        // Sharing asking for a new profile does not downgrade the flight.
        sharing.apply(profile: .retrieverDriving)
        #expect(arbiter.effectiveProfile == .preFlight)

        engine.deliver([Fixtures.fix(0)])
        #expect(flightFixes == 1 && sharingFixes == 1)

        flight.stopRecording()
        #expect(engine.stops == 0)  // sharing still needs the engine
        #expect(engine.applied.last == .retrieverDriving)
        engine.deliver([Fixtures.fix(1)])
        #expect(flightFixes == 1 && sharingFixes == 2)

        sharing.stopRecording()
        #expect(engine.stops == 1)
        #expect(!arbiter.isRunning)
    }

    @Test func flightSessionManagerWorksThroughTheArbiter() throws {
        let engine = FakeLocation()
        let arbiter = LocationArbiter(engine: engine)
        let store = try Fixtures.store()
        let m = FlightSessionManager(store: store, location: arbiter.client(.flight), conditions: { .unknown }, now: { Fixtures.t0.addingTimeInterval(0.5) })
        try m.start(.init(eventId: UUID(), eventName: "Çameli"))
        #expect(engine.started == [.preFlight])
        engine.deliver([Fixtures.fix(0)])
        #expect(m.state == .recording)
        try m.end()
        #expect(engine.stops == 1)
        #expect(try store.flight(id: m.flight!.id)?.visibility == "event")
    }
}

@Suite("Landing prompt")
struct LandingPromptTests {
    let t0 = Fixtures.t0

    func fire(_ d: inout LandingPromptDetector, profile: TrackingProfile, state: FlightSessionState, now: Date) -> Bool {
        d.observe(profile: profile, state: state, now: now)
    }

    @Test func firesOncePerLandingWhileRecording() {
        var d = LandingPromptDetector(enabled: true)
        #expect(!fire(&d, profile: .cruise, state: .recording, now: t0))
        #expect(fire(&d, profile: .landing, state: .recording, now: t0.addingTimeInterval(1)))
        #expect(!fire(&d, profile: .landing, state: .recording, now: t0.addingTimeInterval(2)))
        #expect(!fire(&d, profile: .landing, state: .recording, now: t0.addingTimeInterval(60)))
    }

    @Test func disabledPausedOrNotRecordingNeverFires() {
        var off = LandingPromptDetector(enabled: false)
        #expect(!fire(&off, profile: .landing, state: .recording, now: t0))
        var d = LandingPromptDetector(enabled: true)
        #expect(!fire(&d, profile: .landing, state: .paused, now: t0))
        #expect(!fire(&d, profile: .landing, state: .completed, now: t0))
        #expect(!fire(&d, profile: .landing, state: .preparing, now: t0))
    }

    @Test func stillFlyingSnoozesThenANewLandingPromptsAgain() {
        var d = LandingPromptDetector(enabled: true, snooze: 120)
        #expect(fire(&d, profile: .landing, state: .recording, now: t0))
        d.snooze(now: t0)
        // Took off again and landed within the snooze window: no prompt yet.
        #expect(!fire(&d, profile: .activeFlight, state: .recording, now: t0.addingTimeInterval(30)))
        #expect(!fire(&d, profile: .landing, state: .recording, now: t0.addingTimeInterval(60)))
        // Still landed when the snooze ends: prompt for this landing.
        #expect(fire(&d, profile: .landing, state: .recording, now: t0.addingTimeInterval(121)))
        #expect(!fire(&d, profile: .landing, state: .recording, now: t0.addingTimeInterval(122)))
    }

    @Test func drivenByTheTrackingPolicyLandingProfile() {
        var p = TrackingPolicy(initial: .cruise)
        var d = LandingPromptDetector(enabled: true)
        var fired: [Double] = []
        for s in stride(from: 0.0, through: 60, by: 1) {
            let profile = p.evaluate(PolicyInput(time: t0.addingTimeInterval(s), groundSpeed: 0.5, verticalSpeed: 0.1, turnRate: 0))
            if d.observe(profile: profile, state: .recording, now: t0.addingTimeInterval(s)) { fired.append(s) }
        }
        #expect(fired == [30])  // landing dwell is 30 s
    }
}

@Suite("Event role → sheet mode")
struct EventSheetModeTests {
    func event(role: String?, organizer: Bool = false, applicationsOpen: Bool = true, app: ApplicationRef? = nil) -> Event {
        Event(id: "e", name: "E", status: "active", settings: EventSettings(applicationsOpen: applicationsOpen),
              me: EventMembership(isOrganizer: organizer, role: role, application: app))
    }

    @Test func memberRoles() {
        #expect(EventSheetMode.mode(for: event(role: "pilot")) == .pilot)
        #expect(EventSheetMode.mode(for: event(role: "retriever")) == .retriever)
        #expect(EventSheetMode.mode(for: event(role: "observer")) == .observer)
        #expect(EventSheetMode.mode(for: event(role: "pilot", organizer: true)) == .pilot)
        #expect(EventSheetMode.showsOrganizerTools(event(role: "pilot", organizer: true)))
        #expect(!EventSheetMode.showsOrganizerTools(event(role: "pilot")))
        #expect(EventSheetMode.mode(for: event(role: nil, organizer: true)) == .organizerOnly)
    }

    @Test func nonMemberApplicationStates() {
        #expect(EventSheetMode.mode(for: event(role: nil)) == .notMember(.canApply))
        #expect(EventSheetMode.mode(for: event(role: nil, applicationsOpen: false)) == .notMember(.closed))
        #expect(EventSheetMode.mode(for: event(role: nil, app: ApplicationRef(id: "a", status: "pending")))
                == .notMember(.pending(id: "a")))
        #expect(EventSheetMode.mode(for: event(role: nil, app: ApplicationRef(id: "a", status: "rejected")))
                == .notMember(.rejected(id: "a", canReapply: true)))
        #expect(EventSheetMode.mode(for: event(role: nil, applicationsOpen: false, app: ApplicationRef(id: "a", status: "withdrawn")))
                == .notMember(.withdrawn(id: "a", canReapply: false)))
        // Unknown role strings from a newer server are not treated as membership.
        #expect(EventSheetMode.mode(for: event(role: "rescue_operator")) == .notMember(.canApply))
    }

    @Test func pilotLayer() {
        #expect(!EventSheetMode.showsPilotLayer(event(role: "retriever")))
        #expect(EventSheetMode.showsPilotLayer(event(role: "retriever", organizer: true)))
        #expect(EventSheetMode.showsPilotLayer(event(role: "observer")))
    }
}

@Suite("Retriever board")
@MainActor
struct RetrieverBoardTests {
    @MainActor struct H {
        let server = StubServer()
        let api: APIClient
        let board: RetrieverBoard
        let listPath = "/api/v1/events/\(RetrievalFixtures.eventId)/retrievals"
        init() {
            api = APIClient(baseURL: URL(string: "http://stub.local")!, session: server.makeSession(), tokenStore: InMemoryTokenStore("rt0"))
            server.on("POST", "/api/v1/auth/refresh") { _ in .json(200, Fixtures.auth(access: "a1", refresh: "rt1")) }
            board = RetrieverBoard(eventId: RetrievalFixtures.eventId, eventName: "Çameli", myUserId: "u5", api: api)
        }
    }

    @Test func listsOpenRequestsAndMyPickups() async {
        let h = H()
        h.server.on("GET", h.listPath) { _ in
            .json(200, ["items": [
                RetrievalFixtures.json(id: "r2", status: "requested", requestedAt: "2026-11-05T10:10:00.000Z"),
                RetrievalFixtures.json(id: "r1", status: "requested", requestedAt: "2026-11-05T10:00:00.000Z"),
                RetrievalFixtures.json(id: "r3", status: "accepted", retrieverId: "u5"),
                RetrievalFixtures.json(id: "r4", status: "accepted", retrieverId: "u9"),
            ]])
        }
        var duty: RetrieverDutyState?
        h.board.onDutyStateChange = { duty = $0 }
        await h.board.refresh()
        #expect(h.board.openRequests.map(\.id) == ["r1", "r2"])  // oldest first
        #expect(h.board.myPickups.map(\.id) == ["r3"])
        #expect(duty?.activePickups == 1 && duty?.needsSharing == true)
    }

    @Test func acceptWins() async {
        let h = H()
        h.server.on("GET", h.listPath) { _ in .json(200, ["items": [RetrievalFixtures.json(id: "r1", status: "requested")]]) }
        h.server.on("POST", "/api/v1/retrievals/r1/accept") { _ in .json(200, RetrievalFixtures.json(id: "r1", status: "accepted", retrieverId: "u5")) }
        await h.board.refresh()
        #expect(await h.board.accept("r1") == .accepted)
        #expect(h.board.openRequests.isEmpty)
        #expect(h.board.myPickups.map(\.id) == ["r1"])
        #expect(h.board.notice == nil)
    }

    @Test func acceptRaceLostIsHandledGracefully() async {
        let h = H()
        let calls = LockedBox(0)
        h.server.on("GET", h.listPath) { _ in
            let n = calls.withLock { $0 += 1; return $0 }
            // After the race the other retriever holds it: it is no longer listed for us.
            return .json(200, ["items": n == 1 ? [RetrievalFixtures.json(id: "r1", status: "requested")] : []])
        }
        h.server.on("POST", "/api/v1/retrievals/r1/accept") { _ in .error(409, "conflict") }
        await h.board.refresh()
        #expect(await h.board.accept("r1") == .alreadyTaken)
        #expect(h.board.notice == .alreadyTaken(pilotName: "Deniz"))
        #expect(h.board.openRequests.isEmpty)
        #expect(h.board.myPickups.isEmpty)
        #expect(h.server.requests("GET", h.listPath).count == 2)
    }

    @Test func realtimeAcceptanceByAnotherRetrieverRemovesTheRequest() async throws {
        let h = H()
        h.server.on("GET", h.listPath) { _ in .json(200, ["items": [RetrievalFixtures.json(id: "r1", status: "requested")]]) }
        await h.board.refresh()
        let taken = try JSONCoding.makeDecoder().decode(Retrieval.self, from: JSONSerialization.data(
            withJSONObject: RetrievalFixtures.json(id: "r1", status: "accepted", retrieverId: "u9")))
        h.board.apply(taken)
        #expect(h.board.openRequests.isEmpty && h.board.myPickups.isEmpty)
    }

    @Test func pickupThenDeliveryAndDuty() async throws {
        let h = H()
        h.server.on("GET", h.listPath) { _ in .json(200, ["items": [RetrievalFixtures.json(id: "r3", status: "accepted", retrieverId: "u5")]]) }
        h.server.on("POST", "/api/v1/retrievals/r3/picked-up") { _ in .json(200, RetrievalFixtures.json(id: "r3", status: "picked_up", retrieverId: "u5")) }
        h.server.on("POST", "/api/v1/retrievals/r3/delivered") { _ in .json(200, RetrievalFixtures.json(id: "r3", status: "delivered", retrieverId: "u5")) }
        h.server.on("PUT", "/api/v1/events/\(RetrievalFixtures.eventId)/retrievers/me/duty") { _ in StubResponse(status: 204) }
        await h.board.refresh()
        #expect(await h.board.markPickedUp("r3"))
        #expect(h.board.myPickups.first?.retrievalStatus == .pickedUp)
        #expect(await h.board.markDelivered("r3", note: "Kalkışa bırakıldı"))
        #expect(h.board.myPickups.isEmpty)
        let delivered = try #require(h.server.requests("POST", "/api/v1/retrievals/r3/delivered").first?.json)
        #expect(delivered["note"] as? String == "Kalkışa bırakıldı")
        try await h.board.setDuty(true)
        #expect(h.board.dutyState == RetrieverDutyState(eventId: RetrievalFixtures.eventId, eventName: "Çameli", onDuty: true, activePickups: 0))
        #expect(h.server.requests("PUT", "/api/v1/events/\(RetrievalFixtures.eventId)/retrievers/me/duty").first?.json?["on_duty"] as? Bool == true)
    }
}
