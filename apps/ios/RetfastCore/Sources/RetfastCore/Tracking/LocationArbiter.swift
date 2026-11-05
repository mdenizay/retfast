import Foundation

/// One `CLLocationManager` serves two independent consumers:
/// - `.flight`: the flight recorder (`FlightSessionManager`)
/// - `.sharing`: position sharing while waiting for a retrieve / on retriever duty
///
/// Each consumer gets a proxy that looks like a full `LocationProviding`, so
/// `FlightSessionManager` is unchanged. The arbiter runs the engine while any
/// consumer wants it, with the flight profile taking precedence (it is the
/// most demanding), and fans every fix out to the consumers that asked.
@MainActor
public final class LocationArbiter {
    public enum Client: String, Sendable, CaseIterable { case flight, sharing }

    private let engine: any LocationProviding
    private var demands: [Client: TrackingProfile] = [:]
    private var proxies: [Client: Proxy] = [:]
    public private(set) var isRunning = false
    public private(set) var appliedProfile: TrackingProfile?

    public init(engine: any LocationProviding) {
        self.engine = engine
        engine.onLocations = { [weak self] fixes in self?.deliver(fixes) }
        engine.onAuthorizationChange = { [weak self] auth in
            for p in self?.proxies.values.map({ $0 }) ?? [] { p.onAuthorizationChange?(auth) }
        }
        engine.onError = { [weak self] message in
            guard let self else { return }
            for (client, p) in self.proxies where self.demands[client] != nil { p.onError?(message) }
        }
    }

    /// The proxy for one consumer (created once, then reused).
    public func client(_ c: Client) -> any LocationProviding {
        if let p = proxies[c] { return p }
        let p = Proxy(arbiter: self, client: c)
        proxies[c] = p
        return p
    }

    public func demand(_ c: Client) -> TrackingProfile? { demands[c] }

    /// Flight first: it needs the highest rate and accuracy; sharing piggybacks.
    public var effectiveProfile: TrackingProfile? { demands[.flight] ?? demands[.sharing] }

    fileprivate func set(_ c: Client, _ profile: TrackingProfile?) {
        demands[c] = profile
        reconcile()
    }

    private func reconcile() {
        guard let p = effectiveProfile else {
            if isRunning { engine.stopRecording() }
            isRunning = false
            appliedProfile = nil
            return
        }
        if !isRunning {
            engine.startRecording(profile: p)
            isRunning = true
        } else if appliedProfile != p {
            engine.apply(profile: p)
        }
        appliedProfile = p
    }

    private func deliver(_ fixes: [RawLocation]) {
        for (client, proxy) in proxies where demands[client] != nil {
            proxy.onLocations?(fixes)
        }
    }

    fileprivate var authorization: LocationAuthorization { engine.authorization }
    fileprivate var backgroundSessionActive: Bool { engine.backgroundSessionActive }
    fileprivate var serviceSessionActive: Bool { engine.serviceSessionActive }
    fileprivate func requestWhenInUse() { engine.requestWhenInUseAuthorization() }
    fileprivate func requestAlways() { engine.requestAlwaysAuthorization() }

    @MainActor
    final class Proxy: LocationProviding {
        weak var arbiter: LocationArbiter?
        let client: Client
        var onLocations: (([RawLocation]) -> Void)?
        var onAuthorizationChange: ((LocationAuthorization) -> Void)?
        var onError: ((String) -> Void)?

        init(arbiter: LocationArbiter, client: Client) {
            self.arbiter = arbiter
            self.client = client
        }

        var authorization: LocationAuthorization { arbiter?.authorization ?? .unknown }
        var backgroundSessionActive: Bool { arbiter?.backgroundSessionActive ?? false }
        var serviceSessionActive: Bool { arbiter?.serviceSessionActive ?? false }
        func requestWhenInUseAuthorization() { arbiter?.requestWhenInUse() }
        func requestAlwaysAuthorization() { arbiter?.requestAlways() }
        func startRecording(profile: TrackingProfile) { arbiter?.set(client, profile) }
        func apply(profile: TrackingProfile) {
            guard arbiter?.demand(client) != nil else { return }
            arbiter?.set(client, profile)
        }
        func stopRecording() { arbiter?.set(client, nil) }
    }
}
