import CoreLocation
import Foundation
import Observation
import RetfastCore

/// Live state of one event for the map: pilots, retrievals, retrievers.
///
/// Sources: `GET /events/{id}/live` snapshot (polled: 30 s, 10 s while the
/// socket is down) + realtime `event:<id>` and `retrievals:<id>`.
/// `subscribed.snapshot` replaces state. The socket is never the only source.
@MainActor
@Observable
final class EventLiveModel {
    struct PilotState: Identifiable, Equatable {
        let id: String
        var name: String
        var userId: String?
        var isSimulated: Bool
        var status: String?
        var position: Position?
        var lastReceivedAt: Date?
        var trail: [CLLocationCoordinate2D]
        var freshness: String

        static func == (a: PilotState, b: PilotState) -> Bool {
            a.id == b.id && a.name == b.name && a.isSimulated == b.isSimulated && a.status == b.status
                && a.position == b.position && a.lastReceivedAt == b.lastReceivedAt && a.freshness == b.freshness
                && a.trail.count == b.trail.count
        }

        var coordinate: CLLocationCoordinate2D? {
            position.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }
        }

        func age(now: Date = Date()) -> TimeInterval? {
            (lastReceivedAt ?? position?.receivedAt ?? position?.t).map { max(0, now.timeIntervalSince($0)) }
        }
    }

    private(set) var pilots: [PilotState] = []
    private(set) var retrievals: [Retrieval] = []
    private(set) var retrievers: [LiveRetriever] = []
    private(set) var connection: RealtimeConnectionState = .disconnected
    private(set) var lastUpdate: Date?
    private(set) var error: String?

    @ObservationIgnored private let model: AppModel
    @ObservationIgnored let eventId: String
    @ObservationIgnored private let excludeFlightId: String?
    @ObservationIgnored private let subscribePositions: Bool
    @ObservationIgnored private var tasks: [Task<Void, Never>] = []
    @ObservationIgnored private var running = false
    /// Called for every retrieval update (forwarded to the pilot's manager / retriever board).
    @ObservationIgnored var onRetrieval: ((Retrieval) -> Void)?
    @ObservationIgnored var onRetrievalsSnapshot: (([Retrieval]) -> Void)?
    @ObservationIgnored var onPilotPosition: ((PilotPositionEvent) -> Void)?
    static let maxTrail = 300

    init(model: AppModel, eventId: String, excludeFlightId: String? = nil, subscribePositions: Bool = true) {
        self.model = model
        self.eventId = eventId.lowercased()
        self.excludeFlightId = excludeFlightId?.lowercased()
        self.subscribePositions = subscribePositions
    }

    var eventChannel: String { "event:\(eventId)" }
    var retrievalChannel: String { "retrievals:\(eventId)" }

    func start() async {
        guard !running else { return }
        running = true
        let realtime = model.realtime
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
        // Freshness ticks + REST polling fallback.
        tasks.append(Task { [weak self] in
            var elapsed: Double = 0
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                elapsed += 5
                guard let self else { return }
                self.refreshFreshness()
                let every: Double = self.connection == .connected ? 30 : 10
                if elapsed >= every { elapsed = 0; await self.reload() }
            }
        })
        await reload()
        await realtime.connect()
        if subscribePositions { await realtime.subscribe(eventChannel) }
        await realtime.subscribe(retrievalChannel)
    }

    func stop() {
        running = false
        for t in tasks { t.cancel() }
        tasks = []
        let realtime = model.realtime
        let channels = [eventChannel, retrievalChannel]
        Task { for c in channels { await realtime.unsubscribe(c) } }
    }

    func reload() async {
        do {
            apply(try await model.api.liveSnapshot(eventId: eventId))
            error = nil
        } catch let e as APIError where e.status == 403 || e.status == 404 {
            error = String(localized: "Bu etkinliğin canlı verisini görme yetkin yok.")
        } catch {
            self.error = ErrorText.message(error)
        }
    }

    func freshness(now: Date = Date(), for pilot: PilotState) -> String {
        guard let age = pilot.age(now: now) else { return "lost" }
        return FreshnessBadge.freshness(age: age)
    }

    var openRetrievals: [Retrieval] { retrievals.filter { $0.retrievalStatus?.isOpen ?? false } }

    // MARK: Messages

    private func handle(_ message: RealtimeMessage) {
        switch message {
        case .eventSnapshot(let ch, let snapshot) where ch == eventChannel:
            apply(snapshot)
        case .position(let ch, let event) where ch == eventChannel:
            apply(event)
        case .flight(let ch, let flight) where ch == eventChannel:
            if let i = pilots.firstIndex(where: { $0.id == flight.id.lowercased() }) { pilots[i].status = flight.status }
        case .retrievalsSnapshot(let ch, let list) where ch == retrievalChannel:
            retrievals = list
            onRetrievalsSnapshot?(list)
        case .retrieval(let ch, let r) where ch == retrievalChannel:
            upsert(r)
            onRetrieval?(r)
        case .retrieverPosition(let ch, let e) where ch == retrievalChannel:
            if let i = retrievers.firstIndex(where: { $0.userId == e.userId }) {
                retrievers[i].position = e.position
                retrievers[i].ageS = 0
            } else {
                retrievers.append(LiveRetriever(userId: e.userId, fullName: e.fullName, onDuty: true, position: e.position, ageS: 0, activeRetrievals: nil))
            }
            for i in retrievals.indices where retrievals[i].retriever?.userId == e.userId {
                retrievals[i].retrieverPosition = e.position
            }
        case .pilotPosition(let ch, let e) where ch == retrievalChannel:
            if let i = retrievals.firstIndex(where: { $0.id.lowercased() == e.retrievalId.lowercased() }) {
                retrievals[i].pilotPosition = e.position
            }
            onPilotPosition?(e)
        case .error(let code, let ch) where ch == eventChannel || ch == retrievalChannel:
            if code == "forbidden" && ch == eventChannel { error = nil }  // e.g. retrievers: no general map; expected.
        default:
            break
        }
    }

    private func upsert(_ r: Retrieval) {
        if let i = retrievals.firstIndex(where: { $0.id == r.id }) { retrievals[i] = r } else { retrievals.append(r) }
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
            var state = PilotState(id: id, name: Self.name(p.pilot), userId: p.pilot?.userId, isSimulated: p.isSimulated ?? false,
                                   status: p.status, position: p.position, lastReceivedAt: received,
                                   trail: Array(trail.suffix(Self.maxTrail)), freshness: p.freshness ?? "lost")
            state.freshness = p.freshness ?? freshness(now: now, for: state)
            return state
        }
        if let r = snapshot.retrievals {
            retrievals = r
            onRetrievalsSnapshot?(r)
        }
        if let r = snapshot.retrievers { retrievers = r }
        lastUpdate = now
    }

    private func apply(_ event: LivePositionEvent) {
        let id = event.flightId.lowercased()
        guard id != excludeFlightId else { return }
        let now = Date()
        let coord = CLLocationCoordinate2D(latitude: event.position.lat, longitude: event.position.lon)
        if let i = pilots.firstIndex(where: { $0.id == id }) {
            if let seq = event.position.seq, let old = pilots[i].position?.seq, seq <= old { return }
            pilots[i].position = event.position
            pilots[i].lastReceivedAt = event.position.receivedAt ?? now
            pilots[i].trail.append(coord)
            if pilots[i].trail.count > Self.maxTrail { pilots[i].trail.removeFirst(pilots[i].trail.count - Self.maxTrail) }
            pilots[i].freshness = freshness(now: now, for: pilots[i])
        } else {
            var state = PilotState(id: id, name: Self.name(event.pilot), userId: event.pilot?.userId, isSimulated: event.isSimulated ?? false,
                                   status: "recording", position: event.position, lastReceivedAt: event.position.receivedAt ?? now,
                                   trail: [coord], freshness: "live")
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
