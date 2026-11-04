import CoreLocation
import RetfastCore

/// Single "where am I now" fix for pre-flight and SOS screens when no flight is
/// recording. Separate CLLocationManager so it never interferes with the engine.
@MainActor
@Observable
final class OneShotLocator: NSObject, CLLocationManagerDelegate {
    private(set) var fix: RawLocation?
    private(set) var failed = false
    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    func request() {
        let status = manager.authorizationStatus
        guard status == .authorizedAlways || status == .authorizedWhenInUse else { return }
        failed = false
        manager.requestLocation()
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        let raw = LocationEngine.raw(last)
        MainActor.assumeIsolated { self.fix = raw }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {
        MainActor.assumeIsolated { self.failed = true }
    }
}
