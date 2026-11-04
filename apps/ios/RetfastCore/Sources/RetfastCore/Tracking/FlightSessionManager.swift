import Foundation
import Observation
import os

public struct EngineEvent: Sendable, Equatable, Identifiable {
    public let id = UUID()
    public let at: Date
    public let message: String
}

/// Owns the active flight for the lifetime of the app process. Views observe
/// it; none of them own it, so leaving the flight screen never stops recording.
@MainActor
@Observable
public final class FlightSessionManager {
    public private(set) var state: FlightSessionState = .idle
    public private(set) var flight: LocalFlight?
    public private(set) var values = FlightComputerValues()
    public private(set) var profile: TrackingProfile = .preFlight
    public private(set) var authorization: LocationAuthorization
    public private(set) var track: [TrackPoint] = []
    public private(set) var lastError: String?
    public private(set) var engineEvents: [EngineEvent] = []
    /// Set when the session was restored after the process died while recording
    /// (OS termination, crash, force-quit): the last sample time before the gap.
    public private(set) var interruptedSince: Date?
    public private(set) var storedSampleCount = 0
    public private(set) var emergencyActive = false

    /// Called after each stored sample / on end, to nudge the sync engine.
    public var onSampleStored: (() -> Void)?

    @ObservationIgnored private var machine = FlightSessionStateMachine()
    @ObservationIgnored private var recorder: FlightRecorder?
    @ObservationIgnored private let store: LocalTelemetryStore
    @ObservationIgnored private let location: any LocationProviding
    @ObservationIgnored private let conditions: @MainActor () -> DeviceConditions
    @ObservationIgnored private let now: @MainActor () -> Date
    @ObservationIgnored private static let log = Logger(subsystem: "com.mizibu.retfast", category: "session")
    public static let maxTrackPoints = 5000

    public struct StartOptions: Sendable, Equatable {
        public var eventId: UUID?
        public var eventName: String?
        public var visibility: String
        public var isSimulated: Bool
        public init(eventId: UUID?, eventName: String?, visibility: String, isSimulated: Bool = false) {
            self.eventId = eventId; self.eventName = eventName; self.visibility = visibility; self.isSimulated = isSimulated
        }
    }

    public init(store: LocalTelemetryStore, location: any LocationProviding,
                conditions: @escaping @MainActor () -> DeviceConditions = { DeviceStatus.current() },
                now: @escaping @MainActor () -> Date = { Date() }) {
        self.store = store
        self.location = location
        self.conditions = conditions
        self.now = now
        self.authorization = location.authorization
        location.onLocations = { [weak self] fixes in self?.handle(fixes) }
        location.onAuthorizationChange = { [weak self] auth in self?.authorizationChanged(auth) }
        location.onError = { [weak self] message in self?.record(message) }
    }

    public var isActive: Bool { state.isActive }

    // MARK: Commands

    public func start(_ options: StartOptions) throws {
        guard Self.canStart(state) else { throw FlightSessionStateMachine.InvalidTransition(from: state, event: .start) }
        if authorization.status == .notDetermined { location.requestWhenInUseAuthorization() }
        if authorization.status == .denied || authorization.status == .restricted || !authorization.servicesEnabled {
            lastError = "location_permission_denied"
            throw SessionError.permissionDenied
        }
        let flight = LocalFlight(eventId: options.eventId, eventName: options.eventName, visibility: options.visibility,
                                 isSimulated: options.isSimulated, startedAt: now(), state: .preparing)
        try store.insertFlight(flight)
        try transition(.start)
        self.flight = flight
        recorder = FlightRecorder(flightId: flight.id, store: store)
        recorder?.emergency = emergencyActive
        values = FlightComputerValues()
        track = []
        storedSampleCount = 0
        interruptedSince = nil
        lastError = nil
        profile = .preFlight
        location.startRecording(profile: emergencyActive ? .emergency : .preFlight)
        record("start flight=\(flight.id.uuidString.prefix(8))")
    }

    public func pause() throws {
        try transition(.pause)
        // Stop GPS while paused: saves battery; resume is a foreground action.
        location.stopRecording()
        try persistState()
    }

    public func resume() throws {
        try transition(.resume)
        location.startRecording(profile: profile)
        try persistState()
    }

    public func end() throws {
        guard let flight else { throw SessionError.noFlight }
        if state != .ending {
            try transition(.end)
            try persistState()
        }
        location.stopRecording()
        // ended_at = now, but never before the last stored sample (device clock jumps).
        let endedAt = max(self.flight?.lastSampleAt ?? flight.startedAt, now())
        try store.updateFlight(id: flight.id, { $0.state = .completed; $0.endedAt = endedAt }, now: now())
        try transition(.ended)
        self.flight = try store.flight(id: flight.id)
        record("end flight=\(flight.id.uuidString.prefix(8))")
        onSampleStored?()
    }

    /// Back to idle after the summary was shown.
    public func reset() {
        guard state == .completed || state == .error || state == .idle else { return }
        try? transition(.reset)
        flight = nil
        recorder = nil
        track = []
        values = FlightComputerValues()
        storedSampleCount = 0
        interruptedSince = nil
    }

    /// App launch (including a background relaunch for location events):
    /// restore the persisted active session and restart updates.
    public func restore() {
        guard state == .idle else { return }
        do {
            guard let saved = try store.activeFlight() else { return }
            let samples = try store.samples(flightId: saved.id)
            let recorder = FlightRecorder(flightId: saved.id, store: store,
                                          initialProfile: TrackingProfile(rawValue: saved.profile) ?? .activeFlight)
            recorder.restore(from: samples)
            recorder.emergency = emergencyActive
            self.recorder = recorder
            self.flight = saved
            self.values = recorder.values
            self.profile = recorder.profile
            self.storedSampleCount = samples.count
            self.track = Self.thin(samples.map { TrackPoint(lat: $0.lat, lon: $0.lon, altitude: $0.altitude, t: $0.t) })
            try transition(.restore(saved.state))

            switch saved.state {
            case .recording, .preparing:
                interruptedSince = saved.lastSampleAt ?? saved.startedAt
                try store.updateFlight(id: saved.id, { $0.interruptionCount += 1 }, now: now())
                self.flight = try store.flight(id: saved.id)
                location.startRecording(profile: emergencyActive ? .emergency : recorder.profile)
                record("restored recording flight=\(saved.id.uuidString.prefix(8)) samples=\(samples.count)")
            case .paused:
                record("restored paused flight")
            case .ending:
                try end()
            default:
                break
            }
        } catch {
            lastError = "restore_failed"
            record("restore failed: \(error)")
        }
    }

    public func setEmergency(_ on: Bool) {
        guard emergencyActive != on else { return }
        emergencyActive = on
        if let change = recorder?.setEmergency(on, now: now()) { apply(profile: change) }
        else if on && state == .recording { apply(profile: .emergency) }
    }

    public func requestAlwaysAuthorization() { location.requestAlwaysAuthorization() }
    public func requestWhenInUseAuthorization() { location.requestWhenInUseAuthorization() }

    public var backgroundSessionActive: Bool { location.backgroundSessionActive }
    public var serviceSessionActive: Bool { location.serviceSessionActive }

    public enum SessionError: Error, Equatable { case permissionDenied, noFlight }

    // MARK: Location input

    private func handle(_ fixes: [RawLocation]) {
        guard state == .recording || state == .preparing, let recorder else { return }
        let conditions = conditions()
        for fix in fixes {
            let received = now()
            let result = recorder.handle(fix, conditions: conditions, receivedAt: received)
            if let error = result.writeError {
                lastError = "storage_write_failed"
                record("write failed: \(error)")
            }
            if let sample = result.stored {
                storedSampleCount += 1
                flight?.lastSampleAt = sample.t
                track.append(TrackPoint(lat: sample.lat, lon: sample.lon, altitude: sample.altitude, t: sample.t))
                if track.count > Self.maxTrackPoints { track = Self.thin(track) }
                if state == .preparing && !sample.lowQuality {
                    try? transition(.firstFix)
                    try? persistState()
                }
                onSampleStored?()
            }
            if let change = result.profileChange { apply(profile: change) }
        }
        values = recorder.values
    }

    private func apply(profile new: TrackingProfile) {
        guard new != profile else { return }
        record("profile \(profile.rawValue) → \(new.rawValue)")
        profile = new
        if state == .recording || state == .preparing { location.apply(profile: new) }
    }

    private func authorizationChanged(_ auth: LocationAuthorization) {
        authorization = auth
        if isActive && !auth.canRecord {
            lastError = "location_permission_revoked"
            record("permission revoked while recording")
        }
    }

    // MARK: Helpers

    private func transition(_ event: FlightSessionStateMachine.Event) throws {
        state = try machine.handle(event)
    }

    private func persistState() throws {
        guard let id = flight?.id else { return }
        let s = state
        try store.updateFlight(id: id, { $0.state = s }, now: now())
        flight?.state = s
    }

    private func record(_ message: String) {
        Self.log.info("\(message, privacy: .public)")
        engineEvents.append(EngineEvent(at: now(), message: message))
        if engineEvents.count > 100 { engineEvents.removeFirst(engineEvents.count - 100) }
    }

    static func canStart(_ s: FlightSessionState) -> Bool { s == .idle || s == .completed || s == .error }

    static func thin(_ points: [TrackPoint]) -> [TrackPoint] {
        guard points.count > maxTrackPoints else { return points }
        let stride = Int((Double(points.count) / Double(maxTrackPoints / 2)).rounded(.up))
        var out = Swift.stride(from: 0, to: points.count, by: stride).map { points[$0] }
        if let last = points.last, out.last != last { out.append(last) }
        return out
    }
}
