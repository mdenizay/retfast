import CoreLocation
import UIKit

/// CoreLocation wrapper implementing the adaptive profiles from
/// docs/ios-tracking.md. Captured points go synchronously into PointBuffer;
/// SyncEngine uploads them in batches.
///
/// The whole type is `@MainActor`: it touches `UIApplication` / `UIDevice`,
/// publishes to SwiftUI, and CoreLocation delivers its callbacks on the thread
/// that created the manager — which is pinned to main below.
@MainActor
final class TrackingEngine: NSObject, ObservableObject, @preconcurrency CLLocationManagerDelegate {
    static let shared = TrackingEngine()

    enum Profile: String {
        case performance, balanced, lowPower = "low_power", retriever
    }

    enum Target: Equatable {
        case task(id: UUID)
        case retrieverSession(id: UUID)
    }

    @Published private(set) var isTracking = false
    @Published private(set) var authorization: CLAuthorizationStatus = .notDetermined
    @Published private(set) var lastLocation: CLLocation?
    @Published private(set) var profile: Profile = .performance
    /// -1 when the device does not report battery (simulator).
    @Published private(set) var batteryPercent: Int = -1

    private let manager = CLLocationManager()
    private var target: Target?

    override private init() {
        super.init()
        manager.delegate = self
        manager.allowsBackgroundLocationUpdates = false
        manager.pausesLocationUpdatesAutomatically = false
        manager.showsBackgroundLocationIndicator = true
        // Tells iOS this is vehicle/flight movement, which keeps updates
        // flowing instead of aggressively pausing them when stationary.
        manager.activityType = .otherNavigation

        UIDevice.current.isBatteryMonitoringEnabled = true
        batteryPercent = Self.readBattery()
        NotificationCenter.default.addObserver(
            forName: UIDevice.batteryLevelDidChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.batteryPercent = Self.readBattery() }
        }
    }

    func requestPermissions() {
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse:
            manager.requestAlwaysAuthorization()
        default:
            break
        }
    }

    func start(target: Target) {
        self.target = target
        requestPermissions()
        applyProfile(pick())

        // CoreLocation traps if this is enabled without the "location"
        // background mode — guard so a misbuilt bundle merely loses background
        // tracking instead of crashing mid-flight.
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
        manager.allowsBackgroundLocationUpdates = modes.contains("location")

        manager.startUpdatingLocation()
        // Relaunch insurance: if iOS terminates the app, a significant-change
        // event restarts it and TrackingResume picks the target back up.
        manager.startMonitoringSignificantLocationChanges()
        isTracking = true
    }

    func stop() {
        target = nil
        manager.stopUpdatingLocation()
        manager.stopMonitoringSignificantLocationChanges()
        manager.allowsBackgroundLocationUpdates = false
        isTracking = false
    }

    // MARK: profiles

    private func pick() -> Profile {
        if case .retrieverSession = target { return .retriever }
        let battery = batteryPercent
        if battery >= 0 && battery < 15 { return .lowPower }
        if battery >= 0 && battery < 30 { return .balanced }
        return .performance
    }

    private func applyProfile(_ p: Profile) {
        profile = p
        switch p {
        case .performance:
            manager.desiredAccuracy = kCLLocationAccuracyBest
            manager.distanceFilter = 10
        case .balanced:
            manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
            manager.distanceFilter = 25
        case .lowPower:
            manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
            manager.distanceFilter = 100
        case .retriever:
            manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
            manager.distanceFilter = 50
        }
    }

    private static func readBattery() -> Int {
        let level = UIDevice.current.batteryLevel
        return level < 0 ? -1 : Int(level * 100)
    }

    private var trackingState: String {
        if batteryPercent >= 0 && batteryPercent < 15 { return "low_power" }
        return UIApplication.shared.applicationState == .active ? "foreground" : "background"
    }

    // MARK: CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorization = manager.authorizationStatus
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let target else { return }
        let state = trackingState
        let battery = batteryPercent
        let iso = Self.isoFormatter

        for loc in locations {
            // Drop obviously bogus fixes rather than poisoning the track.
            guard loc.horizontalAccuracy >= 0 else { continue }
            lastLocation = loc

            let id = UUID()
            var payload: [String: Any] = [
                "id": id.uuidString.lowercased(),
                "recorded_at": iso.string(from: loc.timestamp),
                "lat": loc.coordinate.latitude,
                "lng": loc.coordinate.longitude,
                "altitude_m": loc.altitude,
                "h_accuracy_m": loc.horizontalAccuracy,
                "v_accuracy_m": loc.verticalAccuracy,
                "tracking_state": state,
            ]
            if loc.speed >= 0 { payload["speed_mps"] = loc.speed }
            if loc.course >= 0 { payload["heading_deg"] = loc.course }
            if battery >= 0 { payload["battery_pct"] = battery }
            switch target {
            case .task(let taskId): payload["task_id"] = taskId.uuidString.lowercased()
            case .retrieverSession(let sid): payload["retriever_session_id"] = sid.uuidString.lowercased()
            }
            PointBuffer.shared.enqueue(id: id, payload: payload)
        }

        // The location callback is the only trigger that reliably fires while
        // the app is backgrounded — timers do not. Everything else is a bonus.
        SyncEngine.shared.flushIfDue()

        let next = pick()
        if next != profile { applyProfile(next) }
    }

    /// iOS paused updates (e.g. long stationary period) — resume so a landed
    /// pilot does not silently drop off the operation's map.
    func locationManagerDidPauseLocationUpdates(_ manager: CLLocationManager) {
        guard target != nil else { return }
        manager.startUpdatingLocation()
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Transient GPS errors are expected; the HUD surfaces staleness via
        // lastLocation's age rather than reacting to every failure here.
    }

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
