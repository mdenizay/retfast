import CoreLocation
import Foundation
import RetfastCore

/// One point of a recorded track, time relative to the first fix.
struct TrackPoint: Sendable {
    let t: TimeInterval
    let lat: Double
    let lon: Double
    let alt: Double?
    let speed: Double?
    let course: Double?
    /// GPS-derived vertical speed (m/s, centred 8 s window). Not barometric.
    var vario: Double?
    /// Cumulative track distance (m).
    var dist: Double = 0

    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
}

/// Paragliding-oriented flight summary computed from a track.
struct TrackStats: Sendable {
    var duration: TimeInterval = 0
    var distance: Double = 0
    var maxAlt: Double?
    var minAlt: Double?
    var takeoffAlt: Double?
    var landingAlt: Double?
    var maxSpeed: Double?
    var avgSpeed: Double?
    var maxClimb: Double?
    var maxSink: Double?
    var ascent: Double = 0
    var descent: Double = 0
    /// Straight line take-off → landing.
    var straightDistance: Double = 0
    /// Furthest point from take-off.
    var maxFromTakeoff: Double = 0
    /// Share of the flight spent climbing (vario > 0.3 m/s).
    var climbingShare: Double = 0
    /// Climbs of at least 30 s averaging > 0.5 m/s (roughly: thermals used).
    var climbCount = 0
    var bestClimbAvg: Double?
}

struct FlightTrack: Sendable {
    let start: Date
    let points: [TrackPoint]
    let stats: TrackStats

    var duration: TimeInterval { points.last?.t ?? 0 }
    var isEmpty: Bool { points.count < 2 }

    init(samples: [TelemetrySample]) {
        let good = samples.filter { !$0.lowQuality }
        let src = good.count >= max(2, samples.count / 2) ? good : samples
        self.init(raw: src.map { ($0.t, $0.lat, $0.lon, $0.altitude, $0.speed, $0.course) })
    }

    init(positions: [Position]) {
        self.init(raw: positions.map { ($0.t, $0.lat, $0.lon, $0.gpsAltM, $0.speedMs, $0.courseDeg) })
    }

    init(raw input: [(Date, Double, Double, Double?, Double?, Double?)]) {
        let raw = input.sorted { $0.0 < $1.0 }
        guard let first = raw.first else {
            start = .now; points = []; stats = TrackStats(); return
        }
        start = first.0
        var pts: [TrackPoint] = []
        pts.reserveCapacity(raw.count)
        var dist = 0.0
        for r in raw {
            let t = r.0.timeIntervalSince(first.0)
            if let last = pts.last {
                if t <= last.t { continue }
                dist += Fmt.meters((last.lat, last.lon), (r.1, r.2))
            }
            let course = (r.5 ?? -1) >= 0 ? r.5 : nil
            let speed = (r.4 ?? -1) >= 0 ? r.4 : nil
            pts.append(TrackPoint(t: t, lat: r.1, lon: r.2, alt: r.3, speed: speed, course: course, dist: dist))
        }
        // Centred-window vario and fallback ground speed.
        var lo = 0, hi = 0
        for i in pts.indices {
            while pts[lo].t < pts[i].t - 4 { lo += 1 }
            while hi + 1 < pts.count && pts[hi + 1].t <= pts[i].t + 4 { hi += 1 }
            let dt = pts[hi].t - pts[lo].t
            if dt >= 2 {
                if let a = pts[hi].alt, let b = pts[lo].alt { pts[i].vario = (a - b) / dt }
                if pts[i].speed == nil {
                    pts[i] = TrackPoint(t: pts[i].t, lat: pts[i].lat, lon: pts[i].lon, alt: pts[i].alt,
                                        speed: (pts[hi].dist - pts[lo].dist) / dt, course: pts[i].course,
                                        vario: pts[i].vario, dist: pts[i].dist)
                }
            }
        }
        points = pts
        stats = Self.computeStats(pts)
    }

    private static func computeStats(_ p: [TrackPoint]) -> TrackStats {
        var s = TrackStats()
        guard let first = p.first, let last = p.last else { return s }
        s.duration = last.t
        s.distance = last.dist
        let alts = p.compactMap(\.alt)
        s.maxAlt = alts.max(); s.minAlt = alts.min()
        s.takeoffAlt = p.first(where: { $0.alt != nil })?.alt
        s.landingAlt = p.last(where: { $0.alt != nil })?.alt
        s.maxSpeed = p.compactMap(\.speed).max()
        s.avgSpeed = s.duration > 0 ? s.distance / s.duration : nil
        let varios = p.compactMap(\.vario)
        s.maxClimb = varios.max(); s.maxSink = varios.min()
        // Ascent/descent with 3 m hysteresis so GPS noise does not accumulate.
        var ref: Double?
        for a in alts {
            guard let r = ref else { ref = a; continue }
            if a - r >= 3 { s.ascent += a - r; ref = a } else if r - a >= 3 { s.descent += r - a; ref = a }
        }
        s.straightDistance = Fmt.meters((first.lat, first.lon), (last.lat, last.lon))
        s.maxFromTakeoff = p.map { Fmt.meters((first.lat, first.lon), ($0.lat, $0.lon)) }.max() ?? 0
        var climbing = 0.0
        var segStart: Int?
        func closeSegment(_ end: Int) {
            guard let st = segStart else { return }
            let dt = p[end].t - p[st].t
            if dt >= 30, let a = p[end].alt, let b = p[st].alt {
                let avg = (a - b) / dt
                if avg > 0.5 { s.climbCount += 1; s.bestClimbAvg = max(s.bestClimbAvg ?? 0, avg) }
            }
            segStart = nil
        }
        for i in 1..<p.count {
            let v = p[i].vario ?? 0
            if v > 0.3 {
                climbing += p[i].t - p[i - 1].t
                if segStart == nil { segStart = i }
            } else if v < -0.2 {
                closeSegment(i - 1)
            }
        }
        closeSegment(p.count - 1)
        s.climbingShare = s.duration > 0 ? climbing / s.duration : 0
        return s
    }

    /// Interpolated point at `t` seconds.
    func point(at t: TimeInterval) -> TrackPoint {
        guard let first = points.first, let last = points.last else {
            return TrackPoint(t: 0, lat: 0, lon: 0, alt: nil, speed: nil, course: nil)
        }
        if t <= first.t { return first }
        if t >= last.t { return last }
        var lo = 0, hi = points.count - 1
        while hi - lo > 1 {
            let mid = (lo + hi) / 2
            if points[mid].t <= t { lo = mid } else { hi = mid }
        }
        let a = points[lo], b = points[hi]
        let f = (t - a.t) / max(0.001, b.t - a.t)
        func lerp(_ x: Double?, _ y: Double?) -> Double? {
            guard let x, let y else { return x ?? y }
            return x + (y - x) * f
        }
        let course: Double? = {
            if let c = b.course { return c }
            let dy = b.lat - a.lat, dx = (b.lon - a.lon) * cos(a.lat * .pi / 180)
            guard abs(dx) + abs(dy) > 1e-9 else { return a.course }
            return (atan2(dx, dy) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
        }()
        return TrackPoint(t: t, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f,
                          alt: lerp(a.alt, b.alt), speed: lerp(a.speed, b.speed), course: course,
                          vario: lerp(a.vario, b.vario), dist: a.dist + (b.dist - a.dist) * f)
    }

    /// Index of the last point at or before `t`.
    func index(at t: TimeInterval) -> Int {
        var lo = 0, hi = points.count - 1
        guard hi > 0 else { return 0 }
        if t >= points[hi].t { return hi }
        while hi - lo > 1 {
            let mid = (lo + hi) / 2
            if points[mid].t <= t { lo = mid } else { hi = mid }
        }
        return lo
    }

    /// Evenly thinned copy for maps and charts.
    func thinned(_ maxCount: Int) -> [TrackPoint] {
        guard points.count > maxCount else { return points }
        let step = Double(points.count - 1) / Double(maxCount - 1)
        return (0..<maxCount).map { points[Int((Double($0) * step).rounded())] }
    }
}
