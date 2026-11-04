import CoreLocation
import Foundation
import Observation
import RetfastCore

/// Live positions of pilots in one event: REST snapshot first, then the
/// realtime `event:<id>` channel. `subscribed.snapshot` always replaces state.
@MainActor
@Observable
final class LiveMapModel {
    struct PilotState: Identifiable, Equatable {
        let id: String
        var name: String
        var publicId: String?
        var isSimulated: Bool
        var position: Position?
        var lastReceivedAt: Date?
        var trail: [CLLocationCoordinate2D]
        var freshness: String

        static func == (a: PilotState, b: PilotState) -> Bool {
            a.id == b.id && a.name == b.name && a.publicId == b.publicId && a.isSimulated == b.isSimulated
                && a.position == b.position && a.lastReceivedAt == b.lastReceivedAt && a.freshness == b.freshness
                && a.trail.count == b.trail.count
                && zip(a.trail, b.trail).allSatisfy { $0.latitude == $1.latitude && $0.longitude == $1.longitude }
        }

        var coordinate: CLLocationCoordinate2D? {
            position.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }
        }

        func age(now: Date = Date()) -> TimeInterval? {
            (lastReceivedAt ?? position?.receivedAt ?? position?.t).map { max(0, now.timeIntervalSince($0)) }
        }
    }

    private(set) var pilots: [PilotState] = []
    private(set) var connection: RealtimeConnectionState = .disconnected
    private(set) var lastUpdate: Date?
    private(set) var error: String?

    @ObservationIgnored private let model: AppModel
    @ObservationIgnored private let eventId: String
    @ObservationIgnored private let excludeFlightId: String?
    @ObservationIgnored private var tasks: [Task<Void, Never>] = []
    @ObservationIgnored private var running = false
    static let maxTrail = 300

    init(model: AppModel, eventId: String, excludeFlightId: String? = nil) {
        self.model = model
        self.eventId = eventId
        self.excludeFlightId = excludeFlightId?.lowercased()
    }

    var channel: String { "event:\(eventId)" }

    func start() async {
        guard !running else { return }
        running = true
        let realtime = model.realtime
        let channel = self.channel
        tasks.append(Task { [weak self] in
            for await message in realtime.messages.stream() {
                guard let self, !Task.isCancelled else { return }
                self.handle(message)
            }
        })
        tasks.append(Task { [weak self] in
            for await state in realtime.connection.stream() {
                guard let self, !Task.isCancelled else { return }
                self.connection = state
            }
        })
        // Re-evaluate freshness as time passes.
        tasks.append(Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                self?.refreshFreshness()
            }
        })
        do {
            let snapshot = try await model.api.liveSnapshot(eventId: eventId)
            apply(snapshot)
            error = nil
        } catch {
            self.error = ErrorText.message(error)
        }
        await realtime.connect()
        await realtime.subscribe(channel)
    }

    func stop() {
        running = false
        for t in tasks { t.cancel() }
        tasks = []
        let realtime = model.realtime
        let channel = self.channel
        Task { await realtime.unsubscribe(channel) }
    }

    func freshness(now: Date = Date(), for pilot: PilotState) -> String {
        guard let age = pilot.age(now: now) else { return "lost" }
        return FreshnessBadge.freshness(age: age)
    }

    // MARK: Messages

    private func handle(_ message: RealtimeMessage) {
        switch message {
        case .eventSnapshot(let ch, let snapshot) where ch == channel:
            apply(snapshot)
        case .position(let ch, let event) where ch == channel:
            apply(event)
        case .flight(let ch, let flight) where ch == channel:
            if flight.status != "recording", let ended = flight.endedAt, Date().timeIntervalSince(ended) > 7200 {
                pilots.removeAll { $0.id == flight.id.lowercased() }
            }
        case .error(let code, let ch) where ch == nil || ch == channel:
            error = code == "forbidden" ? String(localized: "Bu canlı haritayı görme yetkiniz yok.") : String(localized: "Canlı bağlantı hatası: \(code)")
        default:
            break
        }
    }

    private func apply(_ snapshot: LiveSnapshot) {
        let now = Date()
        pilots = snapshot.pilots.compactMap { p in
            let id = p.flightId.lowercased()
            if id == excludeFlightId { return nil }
            let trail: [CLLocationCoordinate2D] = (p.trail ?? []).compactMap { point in
                guard point.count >= 2, let lon = point[0], let lat = point[1] else { return nil }
                return CLLocationCoordinate2D(latitude: lat, longitude: lon)
            }
            let received = p.position?.receivedAt ?? p.ageS.map { now.addingTimeInterval(-$0) } ?? p.position?.t
            var state = PilotState(id: id, name: Self.name(p.pilot), publicId: p.pilot?.publicId,
                                   isSimulated: p.isSimulated ?? false, position: p.position, lastReceivedAt: received,
                                   trail: Array(trail.suffix(Self.maxTrail)), freshness: p.freshness ?? "lost")
            state.freshness = p.freshness ?? freshness(now: now, for: state)
            return state
        }
        lastUpdate = now
        error = nil
    }

    private func apply(_ event: LivePositionEvent) {
        let id = event.flightId.lowercased()
        guard id != excludeFlightId else { return }
        let now = Date()
        let coord = CLLocationCoordinate2D(latitude: event.position.lat, longitude: event.position.lon)
        if let i = pilots.firstIndex(where: { $0.id == id }) {
            pilots[i].position = event.position
            pilots[i].lastReceivedAt = event.position.receivedAt ?? now
            pilots[i].trail.append(coord)
            if pilots[i].trail.count > Self.maxTrail { pilots[i].trail.removeFirst(pilots[i].trail.count - Self.maxTrail) }
            if let pilot = event.pilot { pilots[i].name = Self.name(pilot) }
            pilots[i].freshness = freshness(now: now, for: pilots[i])
        } else {
            var state = PilotState(id: id, name: Self.name(event.pilot), publicId: event.pilot?.publicId,
                                   isSimulated: event.isSimulated ?? false, position: event.position,
                                   lastReceivedAt: event.position.receivedAt ?? now, trail: [coord], freshness: "live")
            state.freshness = freshness(now: now, for: state)
            pilots.append(state)
        }
        lastUpdate = now
    }

    private func refreshFreshness() {
        let now = Date()
        for i in pilots.indices {
            let f = freshness(now: now, for: pilots[i])
            if pilots[i].freshness != f { pilots[i].freshness = f }
        }
    }

    static func name(_ p: PersonRef?) -> String {
        p?.fullName ?? p?.publicId ?? String(localized: "Pilot")
    }
}
