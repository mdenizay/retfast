import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// Reads battery / Low Power Mode. Battery monitoring is enabled once.
@MainActor
public enum DeviceStatus {
    public static func current() -> DeviceConditions {
        #if canImport(UIKit) && !os(watchOS)
        let device = UIDevice.current
        if !device.isBatteryMonitoringEnabled { device.isBatteryMonitoringEnabled = true }
        let level = device.batteryLevel
        let state: DeviceConditions.BatteryState = switch device.batteryState {
        case .unplugged: .unplugged
        case .charging: .charging
        case .full: .full
        default: .unknown
        }
        return DeviceConditions(batteryLevel: level < 0 ? nil : Double(level), batteryState: state,
                                lowPowerMode: ProcessInfo.processInfo.isLowPowerModeEnabled)
        #else
        return DeviceConditions(batteryLevel: nil, batteryState: .unknown, lowPowerMode: ProcessInfo.processInfo.isLowPowerModeEnabled)
        #endif
    }
}

public struct TrackPoint: Sendable, Equatable {
    public var lat: Double
    public var lon: Double
    public var altitude: Double?
    public var t: Date
    public init(lat: Double, lon: Double, altitude: Double?, t: Date) {
        self.lat = lat; self.lon = lon; self.altitude = altitude; self.t = t
    }
}

/// Turns raw fixes into persisted samples for one flight: validate → filter →
/// policy → **write to SQLite** (synchronously, before anything else sees it).
@MainActor
public final class FlightRecorder {
    public let flightId: UUID
    private let store: LocalTelemetryStore
    public private(set) var processor = TelemetryProcessor()
    public private(set) var policy: TrackingPolicy
    public private(set) var consecutiveWriteFailures = 0

    public struct Result: Sendable {
        public var decision: FixDecision
        public var stored: TelemetrySample?
        public var profileChange: TrackingProfile?
        public var writeError: String?
    }

    public init(flightId: UUID, store: LocalTelemetryStore, initialProfile: TrackingProfile = .preFlight) {
        self.flightId = flightId
        self.store = store
        self.policy = TrackingPolicy(initial: initialProfile)
    }

    public var values: FlightComputerValues { processor.values }
    public var profile: TrackingProfile { policy.profile }

    /// Rebuild filter/statistics state from what is already on disk.
    public func restore(from samples: [TelemetrySample]) {
        processor.replay(samples)
        if let last = samples.last, let p = TrackingProfile(rawValue: last.profile), p.isFlightProfile {
            policy = TrackingPolicy(initial: p, airborne: p != .preFlight)
        }
    }

    public func handle(_ raw: RawLocation, conditions: DeviceConditions, receivedAt: Date) -> Result {
        let profileBefore = policy.profile
        let decision = processor.process(raw, profile: profileBefore, receivedAt: receivedAt)
        var result = Result(decision: decision, stored: nil, profileChange: nil, writeError: nil)

        switch decision {
        case .rejected:
            return result
        case .store(let lowQuality):
            do {
                result.stored = try store.append(NewSample(raw: raw, deviceT: receivedAt, profile: profileBefore,
                                                           conditions: conditions, lowQuality: lowQuality),
                                                 flightId: flightId)
                consecutiveWriteFailures = 0
            } catch {
                consecutiveWriteFailures += 1
                result.writeError = String(describing: error)
            }
        case .presentationOnly:
            break
        }
        let v = processor.values
        let next = policy.evaluate(PolicyInput(time: raw.timestamp, groundSpeed: v.groundSpeed,
                                               verticalSpeed: v.verticalSpeed, turnRate: v.turnRate))
        if next != profileBefore { result.profileChange = next }
        return result
    }
}
