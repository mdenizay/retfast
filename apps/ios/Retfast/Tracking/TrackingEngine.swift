import CoreLocation
import UIKit

/// CoreLocation wrapper implementing the adaptive profiles from
/// docs/ios-tracking.md. Captured points go synchronously into PointBuffer;
/// SyncEngine uploads them in batches.
final class TrackingEngine: NSObject, ObservableObject, CLLocationManagerDelegate {
    static let shared = TrackingEngine()

    enum Profile: String {
        case performance, balanced, lowPower = "low_power", retriever
    }

    enum Target {
        case task(id: UUID)
        case retrieverSession(id: UUID)
    }

    @Published private(set) var isTracking = false
    @Published private(set) var authorization: CLAuthorizationStatus = .notDetermined
    @Published private(set) var lastLocation: CLLocation?
    @Published private(set) var profile: Profile = .performance

    private let manager = CLLocationManager()
    private var target: Target?

    override private init() {
        super.init()
        manager.delegate = self
        manager.allowsBackgroundLocationUpdates = false
        manager.pausesLocationUpdatesAutomatically = false
        manager.showsBackgroundLocationIndicator = true
        UIDevice.current.isBatteryMonitoringEnabled = true
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
        manager.allowsBackgroundLocationUpdates = true
        manager.startUpdatingLocation()
        // Relaunch insurance: if iOS terminates the app, a significant-change
        // event restarts it and AppDelegate resumes precise tracking.
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
        let battery = batteryPct()
        if case .retrieverSession = target { return .retriever }
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

    private func batteryPct() -> Int {
        let level = UIDevice.current.batteryLevel
        return level < 0 ? -1 : Int(level * 100)
    }

    private var trackingState: String {
        if UIDevice.current.batteryLevel >= 0 && batteryPct() < 15 { return "low_power" }
        return UIApplication.shared.applicationState == .active ? "foreground" : "background"
    }

    // MARK: CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorization = manager.authorizationStatus
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let target else { return }
        for loc in locations {
            lastLocation = loc
            var payload: [String: Any] = [
                "id": UUID().uuidString.lowercased(),
                "recorded_at": ISO8601DateFormatter().string(from: loc.timestamp),
                "lat": loc.coordinate.latitude,
                "lng": loc.coordinate.longitude,
                "altitude_m": loc.altitude,
                "h_accuracy_m": loc.horizontalAccuracy,
                "v_accuracy_m": loc.verticalAccuracy,
                "tracking_state": trackingState,
            ]
            if loc.speed >= 0 { payload["speed_mps"] = loc.speed }
            if loc.course >= 0 { payload["heading_deg"] = loc.course }
            let battery = batteryPct()
            if battery >= 0 { payload["battery_pct"] = battery }
            switch target {
            case .task(let id): payload["task_id"] = id.uuidString.lowercased()
            case .retrieverSession(let id): payload["retriever_session_id"] = id.uuidString.lowercased()
            }
            PointBuffer.shared.enqueue(id: UUID(uuidString: payload["id"] as! String)!, payload: payload)
        }
        // Re-evaluate the battery-aware profile as conditions change.
        let next = pick()
        if next != profile { applyProfile(next) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Transient GPS errors are fine; the HUD shows fix quality via lastLocation age.
    }
}
