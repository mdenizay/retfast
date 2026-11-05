import CoreLocation
import RetfastCore

/// Quick "where am I now" fix for pre-flight, retrieve and SOS screens when no
/// flight is recording. Separate CLLocationManager so it never interferes with
/// the engine. Shows the cached/first fix at once and keeps refining until the
/// accuracy is good enough (or a timeout), instead of `requestLocation()`,
/// which waits for the best possible fix before answering.
@MainActor
@Observable
final class OneShotLocator: NSObject, CLLocationManagerDelegate {
    private(set) var fix: RawLocation?
    private(set) var failed = false
    private(set) var refining = false
    private let manager = CLLocationManager()
    private var stopTask: Task<Void, Never>?

    /// Good enough to stop refining (metres).
    var targetAccuracy: Double = 20
    var timeout: Duration = .seconds(20)

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.activityType = .otherNavigation
    }

    func request() {
        let status = manager.authorizationStatus
        guard status == .authorizedAlways || status == .authorizedWhenInUse else { return }
        failed = false
        // A recent cached fix is shown immediately.
        if let cached = manager.location, Date().timeIntervalSince(cached.timestamp) < 60, cached.horizontalAccuracy >= 0 {
            fix = LocationEngine.raw(cached)
        }
        refining = true
        manager.startUpdatingLocation()
        stopTask?.cancel()
        stopTask = Task { [weak self, timeout] in
            try? await Task.sleep(for: timeout)
            guard !Task.isCancelled else { return }
            self?.stop(failedIfEmpty: true)
        }
    }

    func stop(failedIfEmpty: Bool = false) {
        manager.stopUpdatingLocation()
        stopTask?.cancel()
        refining = false
        if failedIfEmpty && fix == nil { failed = true }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last, last.horizontalAccuracy >= 0 else { return }
        let raw = LocationEngine.raw(last)
        MainActor.assumeIsolated {
            // Never replace a better fix with a worse one of similar age.
            if let current = fix, raw.horizontalAccuracy > current.horizontalAccuracy * 1.5,
               raw.timestamp.timeIntervalSince(current.timestamp) < 10 { return }
            fix = raw
            if raw.horizontalAccuracy <= targetAccuracy { stop() }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {
        if (error as? CLError)?.code == .locationUnknown { return }  // transient; keep trying
        MainActor.assumeIsolated { self.stop(failedIfEmpty: true); self.failed = fix == nil }
    }
}
