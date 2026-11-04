import CoreLocation
import Foundation

/// Small one-shot location helper for Explore ("nearby"). Independent of the
/// flight LocationEngine: never requests permission, never starts continuous updates.
@MainActor
final class OneShotLocation: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocation?, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    var isAuthorized: Bool {
        let s = manager.authorizationStatus
        return s == .authorizedWhenInUse || s == .authorizedAlways
    }

    /// Returns the current location, or nil if not authorized / unavailable.
    func current() async -> CLLocation? {
        guard isAuthorized else { return nil }
        if let cached = manager.location, Date().timeIntervalSince(cached.timestamp) < 600 { return cached }
        if continuation != nil { return nil }
        return await withCheckedContinuation { c in
            continuation = c
            manager.requestLocation()
        }
    }

    private func finish(_ location: CLLocation?) {
        continuation?.resume(returning: location)
        continuation = nil
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let last = locations.last
        MainActor.assumeIsolated { self.finish(last) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {
        MainActor.assumeIsolated { self.finish(nil) }
    }
}
