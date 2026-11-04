import Foundation
import CoreLocation
import os

public struct LocationAuthorization: Sendable, Equatable {
    public enum Status: String, Sendable { case notDetermined, restricted, denied, whenInUse, always }
    public var status: Status
    /// false = user chose "Approximate location" (precise disabled).
    public var fullAccuracy: Bool
    public var servicesEnabled: Bool

    public init(status: Status, fullAccuracy: Bool, servicesEnabled: Bool) {
        self.status = status; self.fullAccuracy = fullAccuracy; self.servicesEnabled = servicesEnabled
    }

    public var canRecord: Bool { servicesEnabled && (status == .whenInUse || status == .always) }
    public static let unknown = LocationAuthorization(status: .notDetermined, fullAccuracy: true, servicesEnabled: true)
}

/// Abstraction over the location source so the session manager can be tested
/// with a fake; the only production implementation is `LocationEngine`.
@MainActor
public protocol LocationProviding: AnyObject {
    var onLocations: (([RawLocation]) -> Void)? { get set }
    var onAuthorizationChange: ((LocationAuthorization) -> Void)? { get set }
    var onError: ((String) -> Void)? { get set }
    var authorization: LocationAuthorization { get }
    var backgroundSessionActive: Bool { get }
    var serviceSessionActive: Bool { get }
    func requestWhenInUseAuthorization()
    func requestAlwaysAuthorization()
    func startRecording(profile: TrackingProfile)
    func apply(profile: TrackingProfile)
    func stopRecording()
}

/// Core Location engine (ADR-009). `CLLocationManager` is created on the main
/// thread, so its delegate callbacks arrive on main and are handled with
/// `MainActor.assumeIsolated`.
@MainActor
public final class LocationEngine: NSObject, LocationProviding {
    public var onLocations: (([RawLocation]) -> Void)?
    public var onAuthorizationChange: ((LocationAuthorization) -> Void)?
    public var onError: ((String) -> Void)?

    public private(set) var authorization: LocationAuthorization = .unknown
    public private(set) var isUpdating = false
    public var backgroundSessionActive: Bool { backgroundSession != nil }
    public var serviceSessionActive: Bool { serviceSession != nil }

    private let manager = CLLocationManager()
    /// CLBackgroundActivitySession (iOS 17+), held while recording.
    private var backgroundSession: AnyObject?
    /// CLServiceSession (iOS 18+), held while recording.
    private var serviceSession: AnyObject?
    private static let log = Logger(subsystem: "com.mizibu.retfast", category: "location")

    public override init() {
        super.init()
        manager.delegate = self
        manager.activityType = .airborne
        manager.pausesLocationUpdatesAutomatically = false
        #if os(iOS)
        manager.showsBackgroundLocationIndicator = true
        #endif
        authorization = Self.read(manager)
    }

    nonisolated static func read(_ manager: CLLocationManager) -> LocationAuthorization {
        let status: LocationAuthorization.Status = switch manager.authorizationStatus {
        case .notDetermined: .notDetermined
        case .restricted: .restricted
        case .denied: .denied
        case .authorizedAlways: .always
        #if os(iOS)
        case .authorizedWhenInUse: .whenInUse
        #endif
        @unknown default: .denied
        }
        return LocationAuthorization(status: status,
                                     fullAccuracy: manager.accuracyAuthorization == .fullAccuracy,
                                     servicesEnabled: CLLocationManager.locationServicesEnabled())
    }

    public func requestWhenInUseAuthorization() { manager.requestWhenInUseAuthorization() }
    public func requestAlwaysAuthorization() { manager.requestAlwaysAuthorization() }

    /// Ask for temporary precise location when the user chose "approximate".
    public func requestTemporaryFullAccuracy() {
        #if os(iOS)
        manager.requestTemporaryFullAccuracyAuthorization(withPurposeKey: "FlightRecording")
        #endif
    }

    public func startRecording(profile: TrackingProfile) {
        apply(profile: profile)
        #if os(iOS)
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
        // Setting this without the `location` background mode traps; guard so
        // a misconfigured build loses background tracking instead of crashing.
        manager.allowsBackgroundLocationUpdates = modes.contains("location")
        if backgroundSession == nil {
            backgroundSession = CLBackgroundActivitySession()
        }
        if #available(iOS 18.0, *), serviceSession == nil {
            serviceSession = CLServiceSession(authorization: .always)
        }
        #endif
        manager.startUpdatingLocation()
        // Documented relaunch path: if iOS (not the user) terminates the app,
        // a significant-change event relaunches it in the background and the
        // session manager restores the flight. Requires Always authorization.
        if CLLocationManager.significantLocationChangeMonitoringAvailable() {
            manager.startMonitoringSignificantLocationChanges()
        }
        isUpdating = true
        Self.log.info("location updates started profile=\(profile.rawValue, privacy: .public)")
    }

    public func apply(profile: TrackingProfile) {
        let s = profile.settings
        manager.desiredAccuracy = s.desiredAccuracy == ProfileSettings.accuracyBestForNavigation
            ? kCLLocationAccuracyBestForNavigation
            : (s.desiredAccuracy == ProfileSettings.accuracyBest ? kCLLocationAccuracyBest : s.desiredAccuracy)
        manager.distanceFilter = s.distanceFilter < 0 ? kCLDistanceFilterNone : s.distanceFilter
    }

    public func stopRecording() {
        manager.stopUpdatingLocation()
        manager.stopMonitoringSignificantLocationChanges()
        #if os(iOS)
        manager.allowsBackgroundLocationUpdates = false
        (backgroundSession as? CLBackgroundActivitySession)?.invalidate()
        if #available(iOS 18.0, *) { (serviceSession as? CLServiceSession)?.invalidate() }
        #endif
        backgroundSession = nil
        serviceSession = nil
        isUpdating = false
        Self.log.info("location updates stopped")
    }

    /// One-shot update for screens that just want "where am I" (pre-flight, explore).
    public func requestOneShotLocation() { manager.requestLocation() }

    nonisolated public static func raw(_ l: CLLocation) -> RawLocation {
        var ellipsoidal: Double?
        if #available(iOS 15.0, macOS 12.0, *) { ellipsoidal = l.ellipsoidalAltitude }
        var simulated = false
        if #available(iOS 15.0, macOS 12.0, *) { simulated = l.sourceInformation?.isSimulatedBySoftware ?? false }
        return RawLocation(timestamp: l.timestamp, latitude: l.coordinate.latitude, longitude: l.coordinate.longitude,
                           altitude: l.altitude, ellipsoidalAltitude: ellipsoidal,
                           horizontalAccuracy: l.horizontalAccuracy, verticalAccuracy: l.verticalAccuracy,
                           speed: l.speed, speedAccuracy: l.speedAccuracy, course: l.course,
                           courseAccuracy: l.courseAccuracy, floor: l.floor?.level,
                           isSimulatedBySoftware: simulated)
    }
}

extension LocationEngine: CLLocationManagerDelegate {
    nonisolated public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let raws = locations.map(Self.raw)
        MainActor.assumeIsolated {
            self.onLocations?(raws)
        }
    }

    nonisolated public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let auth = Self.read(manager)
        MainActor.assumeIsolated {
            self.authorization = auth
            Self.log.info("authorization \(auth.status.rawValue, privacy: .public) full=\(auth.fullAccuracy)")
            self.onAuthorizationChange?(auth)
        }
    }

    nonisolated public func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {
        let code = (error as? CLError)?.code
        let message: String = switch code {
        case .locationUnknown: "location_unknown"  // transient: no fix yet
        case .denied: "denied"
        case .network: "network"
        default: "cl_error_\((error as NSError).code)"
        }
        MainActor.assumeIsolated {
            Self.log.error("location error \(message, privacy: .public)")
            self.onError?(message)
        }
    }

    nonisolated public func locationManagerDidPauseLocationUpdates(_ manager: CLLocationManager) {
        // Should not happen (pausesLocationUpdatesAutomatically = false); surface it if it does.
        MainActor.assumeIsolated { self.onError?("updates_paused_by_system") }
    }

    nonisolated public func locationManagerDidResumeLocationUpdates(_ manager: CLLocationManager) {
        MainActor.assumeIsolated { self.onError?("updates_resumed_by_system") }
    }
}
