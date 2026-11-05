import Foundation
import Testing
@testable import RetfastCore

@Suite("Flight session state machine")
struct FlightSessionStateMachineTests {
    @Test func happyPath() throws {
        var m = FlightSessionStateMachine()
        #expect(try m.handle(.start) == .preparing)
        #expect(try m.handle(.firstFix) == .recording)
        #expect(try m.handle(.pause) == .paused)
        #expect(try m.handle(.resume) == .recording)
        #expect(try m.handle(.end) == .ending)
        #expect(try m.handle(.ended) == .completed)
        #expect(try m.handle(.reset) == .idle)
    }

    @Test func invalidTransitionsThrow() {
        var m = FlightSessionStateMachine()
        #expect(throws: FlightSessionStateMachine.InvalidTransition.self) { try m.handle(.pause) }
        #expect(throws: FlightSessionStateMachine.InvalidTransition.self) { try m.handle(.ended) }
        #expect(m.state == .idle)
        _ = try? m.handle(.start)
        #expect(throws: FlightSessionStateMachine.InvalidTransition.self) { try m.handle(.start) }
        #expect(throws: FlightSessionStateMachine.InvalidTransition.self) { try m.handle(.resume) }
    }

    @Test func restoreOnlyActiveStatesFromIdle() throws {
        var m = FlightSessionStateMachine()
        #expect(throws: FlightSessionStateMachine.InvalidTransition.self) { try m.handle(.restore(.completed)) }
        #expect(try m.handle(.restore(.paused)) == .paused)
        var m2 = FlightSessionStateMachine(state: .recording)
        #expect(throws: FlightSessionStateMachine.InvalidTransition.self) { try m2.handle(.restore(.recording)) }
    }

    @Test func errorRecovery() throws {
        var m = FlightSessionStateMachine(state: .recording)
        #expect(try m.handle(.fail("x")) == .error)
        #expect(try m.handle(.resume) == .recording)
        _ = try m.handle(.fail("y"))
        #expect(try m.handle(.end) == .ending)
    }
}

@MainActor
final class FakeLocation: LocationProviding {
    var onLocations: (([RawLocation]) -> Void)?
    var onAuthorizationChange: ((LocationAuthorization) -> Void)?
    var onError: ((String) -> Void)?
    var authorization = LocationAuthorization(status: .always, fullAccuracy: true, servicesEnabled: true)
    var backgroundSessionActive = false
    var serviceSessionActive = false
    var started: [TrackingProfile] = []
    var applied: [TrackingProfile] = []
    var stops = 0
    func requestWhenInUseAuthorization() {}
    func requestAlwaysAuthorization() {}
    func startRecording(profile: TrackingProfile) { started.append(profile); backgroundSessionActive = true }
    func apply(profile: TrackingProfile) { applied.append(profile) }
    func stopRecording() { stops += 1; backgroundSessionActive = false }
    func deliver(_ fixes: [RawLocation]) { onLocations?(fixes) }
}

@Suite("Flight session manager")
@MainActor
struct FlightSessionManagerTests {
    final class TimeBox { var now = Fixtures.t0 }

    func makeManager(store: LocalTelemetryStore, location: FakeLocation, time: TimeBox) -> FlightSessionManager {
        FlightSessionManager(store: store, location: location, conditions: { .unknown }, now: { time.now })
    }

    @Test func recordsPersistsAndEnds() throws {
        let store = try Fixtures.store()
        let loc = FakeLocation(), time = TimeBox()
        let m = makeManager(store: store, location: loc, time: time)
        try m.start(.init(eventId: nil, eventName: nil))
        #expect(m.state == .preparing)
        #expect(loc.started == [.preFlight])

        // Low-quality first fix: stored but does not count as "first fix".
        time.now = Fixtures.t0.addingTimeInterval(0.2)
        loc.deliver([Fixtures.fix(0, hAcc: 80)])
        #expect(m.state == .preparing)
        time.now = Fixtures.t0.addingTimeInterval(6)
        loc.deliver([Fixtures.fix(6)])
        #expect(m.state == .recording)
        #expect(try store.flight(id: m.flight!.id)?.state == .recording)
        #expect(try store.samples(flightId: m.flight!.id).map(\.seq) == [0, 1])

        // Leaving the screen is irrelevant: nothing here references a view.
        try m.end()
        #expect(m.state == .completed)
        #expect(loc.stops == 1)
        let saved = try store.flight(id: m.flight!.id)!
        #expect(saved.state == .completed)
        #expect(saved.endedAt != nil)
        m.reset()
        #expect(m.state == .idle)
    }

    @Test func restoresAfterRelaunchAndKeepsSeqMonotonic() throws {
        let url = Fixtures.tempURL()
        let time = TimeBox()
        var flightId: UUID?
        do {
            let store = try LocalTelemetryStore.open(at: url)
            let loc = FakeLocation()
            let m = makeManager(store: store, location: loc, time: time)
            try m.start(.init(eventId: nil, eventName: nil))
            for i in 0..<12 {
                time.now = Fixtures.t0.addingTimeInterval(Double(i * 5) + 0.1)
                loc.deliver([Fixtures.fix(i, dt: 5)])
            }
            #expect(m.state == .recording)
            flightId = m.flight?.id
        } // process "dies" here: nothing calls end().

        let store = try LocalTelemetryStore.open(at: url)
        let loc = FakeLocation()
        let m = makeManager(store: store, location: loc, time: time)
        m.restore()
        #expect(m.state == .recording)
        #expect(m.flight?.id == flightId)
        #expect(loc.started.count == 1)
        #expect(m.interruptedSince != nil)
        #expect(m.flight?.interruptionCount == 1)
        #expect(m.values.acceptedSamples == 12)

        time.now = Fixtures.t0.addingTimeInterval(200)
        loc.deliver([Fixtures.fix(40, dt: 5)])
        let seqs = try store.samples(flightId: flightId!).map(\.seq)
        #expect(seqs == Array(0...12))
    }

    @Test func pauseStopsLocationAndIgnoresFixes() throws {
        let store = try Fixtures.store()
        let loc = FakeLocation(), time = TimeBox()
        let m = makeManager(store: store, location: loc, time: time)
        try m.start(.init(eventId: nil, eventName: nil))
        time.now = Fixtures.t0.addingTimeInterval(0.1)
        loc.deliver([Fixtures.fix(0)])
        try m.pause()
        #expect(loc.stops == 1)
        loc.deliver([Fixtures.fix(10)])
        #expect(m.storedSampleCount == 1)
        try m.resume()
        #expect(m.state == .recording)
    }

    @Test func deniedPermissionRefusesStart() throws {
        let store = try Fixtures.store()
        let loc = FakeLocation(), time = TimeBox()
        loc.authorization = LocationAuthorization(status: .denied, fullAccuracy: true, servicesEnabled: true)
        let m = makeManager(store: store, location: loc, time: time)
        #expect(throws: FlightSessionManager.SessionError.permissionDenied) {
            try m.start(.init(eventId: nil, eventName: nil))
        }
        #expect(m.state == .idle)
    }
}

@Suite("Tracking policy")
struct TrackingPolicyTests {
    let t0 = Fixtures.t0
    func input(_ s: Double, speed: Double?, vario: Double?, turn: Double?) -> PolicyInput {
        PolicyInput(time: t0.addingTimeInterval(s), groundSpeed: speed, verticalSpeed: vario, turnRate: turn)
    }

    @Test func takeoffNeedsDwell() {
        var p = TrackingPolicy()
        #expect(p.evaluate(input(0, speed: 6, vario: 0, turn: 0)) == .preFlight)
        #expect(p.evaluate(input(3, speed: 6, vario: 0, turn: 0)) == .preFlight)
        #expect(p.evaluate(input(5, speed: 6, vario: 0, turn: 0)) == .activeFlight)
        #expect(p.airborne)
    }

    @Test func singleNoisyFixDoesNotFlip() {
        var p = TrackingPolicy(initial: .activeFlight)
        _ = p.evaluate(input(0, speed: 8, vario: 1.2, turn: 15))  // thermal candidate
        _ = p.evaluate(input(1, speed: 8, vario: -0.5, turn: 2))  // broken: candidate changes
        #expect(p.evaluate(input(11, speed: 8, vario: 1.2, turn: 15)) == .activeFlight)
    }

    @Test func thermalCruiseLanding() {
        var p = TrackingPolicy(initial: .activeFlight)
        for s in stride(from: 0.0, through: 10, by: 1) { _ = p.evaluate(input(s, speed: 9, vario: 1.5, turn: 18)) }
        #expect(p.profile == .thermal)
        for s in stride(from: 20.0, through: 40, by: 1) { _ = p.evaluate(input(s, speed: 11, vario: -1.0, turn: 1)) }
        #expect(p.profile == .cruise)
        for s in stride(from: 50.0, through: 80, by: 1) { _ = p.evaluate(input(s, speed: 0.5, vario: 0.1, turn: 0)) }
        #expect(p.profile == .landing)
        // Relaunch from landing field never returns to pre-flight.
        for s in stride(from: 90.0, through: 110, by: 1) { _ = p.evaluate(input(s, speed: 7, vario: 0, turn: 10)) }
        #expect(p.profile == .activeFlight)
    }

    @Test func missingDataKeepsProfile() {
        var p = TrackingPolicy(initial: .thermal)
        for s in 0..<60 { _ = p.evaluate(input(Double(s), speed: nil, vario: nil, turn: nil)) }
        #expect(p.profile == .thermal)
    }

    @Test func profileTargets() {
        for p in [TrackingProfile.activeFlight, .thermal, .cruise, .landing] {
            #expect(p.settings.desiredAccuracy == ProfileSettings.accuracyBestForNavigation)
        }
        #expect(TrackingProfile.cruise.settings.minSampleInterval > TrackingProfile.thermal.settings.minSampleInterval)
        for p in [TrackingProfile.preFlight, .activeFlight, .thermal, .cruise, .landing] {
            #expect(p.settings.activity == .airborne)
            #expect(p.isFlightProfile)
        }
        // Sharing profiles: lower power, never chosen by the flight policy.
        #expect(TrackingProfile.retrieveWaiting.settings.activity == .fitness)
        #expect(TrackingProfile.retrieveWaiting.settings.desiredAccuracy == ProfileSettings.accuracyNearestTenMeters)
        #expect(TrackingProfile.retrieveWaiting.settings.minSampleInterval == 30)
        #expect(TrackingProfile.retrieverDriving.settings.activity == .automotiveNavigation)
        #expect(TrackingProfile.retrieverDriving.settings.minSampleInterval == 15)
        #expect(!TrackingProfile.retrieveWaiting.isFlightProfile && !TrackingProfile.retrieverDriving.isFlightProfile)
        #expect(TrackingPolicy(initial: .retrieveWaiting).profile == .activeFlight)
    }
}

@Suite("Telemetry processor")
struct TelemetryProcessorTests {
    @Test func rejectsInvalidFixes() {
        var p = TelemetryProcessor()
        let t = Fixtures.t0
        func raw(lat: Double = 37, lon: Double = 29, hAcc: Double = 5, at s: Double = 0) -> RawLocation {
            RawLocation(timestamp: t.addingTimeInterval(s), latitude: lat, longitude: lon, altitude: 1000,
                        horizontalAccuracy: hAcc, verticalAccuracy: 3, speed: 5, course: 10)
        }
        #expect(p.process(raw(hAcc: -1), profile: .activeFlight, receivedAt: t) == .rejected(.invalidAccuracy))
        #expect(p.process(raw(lat: .nan), profile: .activeFlight, receivedAt: t) == .rejected(.nonFiniteValue))
        #expect(p.process(raw(lat: 0, lon: 0), profile: .activeFlight, receivedAt: t) == .rejected(.zeroCoordinates))
        #expect(p.process(raw(lat: 91), profile: .activeFlight, receivedAt: t) == .rejected(.outOfRange))
        #expect(p.process(raw(at: -100), profile: .activeFlight, receivedAt: t) == .rejected(.staleCachedFix))
        #expect(p.process(raw(at: 1), profile: .activeFlight, receivedAt: t.addingTimeInterval(1)) == .store(lowQuality: false))
        #expect(p.process(raw(at: 1), profile: .activeFlight, receivedAt: t.addingTimeInterval(1)) == .rejected(.notNewer))
        #expect(p.values.rejectedFixes == 6)
    }

    @Test func lowQualityKeptButExcludedFromStats() {
        var p = TelemetryProcessor()
        let a = Fixtures.fix(0), b = Fixtures.fix(1, hAcc: 120), c = Fixtures.fix(2)
        #expect(p.process(a, profile: .activeFlight, receivedAt: a.timestamp) == .store(lowQuality: false))
        #expect(p.process(b, profile: .activeFlight, receivedAt: b.timestamp) == .store(lowQuality: true))
        #expect(p.values.lowQuality)
        let d0 = p.values.distance
        #expect(d0 == 0)
        #expect(p.process(c, profile: .activeFlight, receivedAt: c.timestamp) == .store(lowQuality: false))
        #expect(abs(p.values.distance - Geo.distance(a.latitude, a.longitude, c.latitude, c.longitude)) < 0.01)
    }

    @Test func throttlesPerProfile() {
        var p = TelemetryProcessor()
        var stored = 0
        for i in 0..<30 {
            let f = Fixtures.fix(i)
            if case .store = p.process(f, profile: .cruise, receivedAt: f.timestamp) { stored += 1 }
        }
        #expect(stored == 10) // 1 per 3 s
    }

    @Test func verticalSpeedFilterTracksClimbAndSmoothsNoise() {
        var p = TelemetryProcessor()
        var rng = SeededRandom(seed: 42)
        var rawDiffs: [Double] = []
        var lastAlt: Double?
        for i in 0..<120 {
            let truth = 1500 + 2.0 * Double(i)  // 2 m/s climb
            let noisy = truth + rng.gaussian() * 4
            if let lastAlt { rawDiffs.append(noisy - lastAlt) }
            lastAlt = noisy
            let f = Fixtures.fix(i, alt: noisy, vAcc: 4)
            _ = p.process(f, profile: .thermal, receivedAt: f.timestamp)
        }
        let vs = p.values.verticalSpeed!
        #expect(abs(vs - 2.0) < 0.6)
        // Raw point-to-point "vario" is far noisier than the filtered estimate.
        let rawStd = sqrt(rawDiffs.map { pow($0 - 2, 2) }.reduce(0, +) / Double(rawDiffs.count))
        #expect(rawStd > 3)
        #expect(p.values.totalAscent > 200)
    }

    @Test func replayRebuildsStats() {
        var p = TelemetryProcessor()
        let samples = (0..<10).map { i in
            TelemetrySample(flightId: UUID(), seq: i, t: Fixtures.t0.addingTimeInterval(Double(i)), deviceT: Fixtures.t0,
                            lat: 37 + Double(i) * 0.001, lon: 29, altitude: 1000 + Double(i * 10), hAcc: 5, vAcc: 3,
                            speed: 10, course: 0, profile: "cruise", battery: nil, lowPower: false, lowQuality: false)
        }
        p.replay(samples)
        #expect(p.values.acceptedSamples == 10)
        #expect(p.values.distance > 900)
        #expect(p.values.maxGroundSpeed == 10)
    }
}

struct SeededRandom {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> Double {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return Double(state >> 11) / Double(1 << 53)
    }
    mutating func gaussian() -> Double {
        let u1 = max(next(), 1e-12), u2 = next()
        return sqrt(-2 * log(u1)) * cos(2 * .pi * u2)
    }
}
