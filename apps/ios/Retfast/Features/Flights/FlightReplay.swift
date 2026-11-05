import Charts
import MapKit
import RetfastCore
import SwiftUI

/// Drives replay time. Plays at `rate` × real time; a 30 fps task loop
/// advances `time` and stops at the end.
@Observable @MainActor
final class ReplayEngine {
    static let rates: [Double] = [1, 2, 4, 8, 16, 32, 64]

    let track: FlightTrack
    var time: TimeInterval = 0
    var isPlaying = false
    var rate: Double
    private var loop: Task<Void, Never>?

    init(track: FlightTrack) {
        self.track = track
        // Default: the whole flight in roughly 90 s.
        let ideal = track.duration / 90
        rate = Self.rates.min { abs($0 - ideal) < abs($1 - ideal) } ?? 8
    }

    var point: TrackPoint { track.point(at: time) }
    var progress: Double { track.duration > 0 ? time / track.duration : 0 }

    func toggle() { isPlaying ? pause() : play() }

    func play() {
        guard !track.isEmpty else { return }
        if time >= track.duration { time = 0 }
        isPlaying = true
        loop?.cancel()
        loop = Task { [weak self] in
            var last = ContinuousClock.now
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(33))
                guard let self, self.isPlaying else { return }
                let now = ContinuousClock.now
                let dt = Double((now - last).components.attoseconds) / 1e18 + Double((now - last).components.seconds)
                last = now
                self.time = min(self.track.duration, self.time + dt * self.rate)
                if self.time >= self.track.duration { self.isPlaying = false; return }
            }
        }
    }

    func pause() { isPlaying = false; loop?.cancel(); loop = nil }

    func seek(_ t: TimeInterval) { time = min(max(0, t), track.duration) }
    func skip(_ s: TimeInterval) { seek(time + s) }

    func cycleRate() {
        let i = Self.rates.firstIndex(of: rate) ?? 0
        rate = Self.rates[(i + 1) % Self.rates.count]
    }
}

/// Full-screen flight replay: map with travelled track and glider marker,
/// live values, altitude profile with a scrubbable cursor, and transport.
struct FlightReplayView: View {
    let title: String
    @State private var engine: ReplayEngine
    @State private var camera: MapCameraPosition = .automatic
    @State private var follow = true
    @State private var lastCameraUpdate: TimeInterval = -100
    @Environment(\.dismiss) private var dismiss

    private let mapPoints: [TrackPoint]
    private let chartPoints: [TrackPoint]

    init(track: FlightTrack, title: String) {
        self.title = title
        _engine = State(initialValue: ReplayEngine(track: track))
        mapPoints = track.thinned(1500)
        chartPoints = track.thinned(300)
    }

    var body: some View {
        ZStack(alignment: .top) {
            map
            topBar
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { panel }
        .background(Brand.ink)
        .onChange(of: engine.time) { _, t in updateCamera(t) }
        .onAppear { fitWholeTrack() }
        .onDisappear { engine.pause() }
        .sensoryFeedback(.selection, trigger: engine.rate)
    }

    // MARK: Map

    private var travelled: [CLLocationCoordinate2D] {
        let t = engine.time
        var coords = mapPoints.prefix { $0.t <= t }.map(\.coordinate)
        coords.append(engine.point.coordinate)
        return coords
    }

    private var map: some View {
        Map(position: $camera, interactionModes: .all) {
            MapPolyline(coordinates: mapPoints.map(\.coordinate))
                .stroke(.white.opacity(0.45), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round, dash: [4, 4]))
            MapPolyline(coordinates: travelled)
                .stroke(Brand.gradient, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
            if let first = mapPoints.first {
                Annotation(String(localized: "Kalkış"), coordinate: first.coordinate) { endpointDot(AeroTokens.success) }
            }
            if let last = mapPoints.last {
                Annotation(String(localized: "İniş"), coordinate: last.coordinate) { endpointDot(AeroTokens.error) }
            }
            Annotation("", coordinate: engine.point.coordinate) {
                HeadingMarker(course: engine.point.course, tint: Brand.accent, isMe: true)
            }
        }
        .mapStyle(.hybrid(elevation: .realistic))
        .mapControls { MapCompass(); MapScaleView() }
        .onMapCameraChange(frequency: .onEnd) { ctx in
            // A user pan while following turns follow off.
            if follow && engine.isPlaying == false,
               Fmt.meters((ctx.region.center.latitude, ctx.region.center.longitude), (engine.point.lat, engine.point.lon)) > 400 {
                follow = false
            }
        }
        .ignoresSafeArea()
    }

    private func endpointDot(_ c: Color) -> some View {
        Circle().fill(c).frame(width: 12, height: 12).overlay(Circle().stroke(.white, lineWidth: 2))
    }

    private func updateCamera(_ t: TimeInterval) {
        guard follow else { return }
        // Throttle camera moves (~2 per second of wall time).
        let wall = t / max(engine.rate, 1)
        guard abs(wall - lastCameraUpdate) >= 0.5 else { return }
        lastCameraUpdate = wall
        let p = engine.point
        withAnimation(.linear(duration: 0.5)) {
            camera = .camera(MapCamera(centerCoordinate: p.coordinate, distance: 2800, heading: 0, pitch: 50))
        }
    }

    private func fitWholeTrack() {
        let lats = mapPoints.map(\.lat), lons = mapPoints.map(\.lon)
        guard let minLat = lats.min(), let maxLat = lats.max(), let minLon = lons.min(), let maxLon = lons.max() else { return }
        camera = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2),
                                            span: MKCoordinateSpan(latitudeDelta: max(0.01, (maxLat - minLat) * 1.6),
                                                                   longitudeDelta: max(0.01, (maxLon - minLon) * 1.6))))
        follow = false
    }

    // MARK: Chrome

    private var topBar: some View {
        HStack(spacing: AeroTokens.Space.s2) {
            glassButton("xmark", "Kapat") { dismiss() }
                .accessibilityIdentifier("replay.close")
            Text(title)
                .font(.headline).foregroundStyle(.white).lineLimit(1)
                .padding(.horizontal, 14).frame(height: 40)
                .background(.ultraThinMaterial, in: Capsule())
                .environment(\.colorScheme, .dark)
            Spacer()
            glassButton(follow ? "location.fill" : "location", "Takip et") {
                follow.toggle()
                if follow { lastCameraUpdate = -100; updateCamera(engine.time) } else { fitWholeTrack() }
            }
            .accessibilityIdentifier("replay.follow")
        }
        .padding(.horizontal, AeroTokens.Space.s4)
        .padding(.top, AeroTokens.Space.s2)
    }

    private func glassButton(_ icon: String, _ label: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(icon: icon)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(.ultraThinMaterial, in: Circle())
                .environment(\.colorScheme, .dark)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
    }

    private var panel: some View {
        let p = engine.point
        return VStack(spacing: AeroTokens.Space.s3) {
            HStack(spacing: AeroTokens.Space.s2) {
                tile(String(localized: "İrtifa"), Fmt.altitude(p.alt))
                tile(String(localized: "Vario"), Fmt.vario(p.vario), tone: (p.vario ?? 0) > 0.3 ? .success : (p.vario ?? 0) < -2 ? .warning : .neutral)
                tile(String(localized: "Hız"), Fmt.speed(p.speed))
                tile(String(localized: "Mesafe"), Fmt.distance(p.dist))
            }
            profileChart
            HStack {
                Text(Fmt.duration(engine.time)).monospacedDigit()
                Spacer()
                Text(Fmt.time(engine.track.start.addingTimeInterval(engine.time))).monospacedDigit().foregroundStyle(AeroTokens.textMuted)
                Spacer()
                Text("-" + Fmt.duration(engine.track.duration - engine.time)).monospacedDigit()
            }
            .font(.caption.weight(.medium))
            .foregroundStyle(AeroTokens.textSecondary)
            transport
        }
        .padding(AeroTokens.Space.s4)
        .background(AeroTokens.surface, in: UnevenRoundedRectangle(topLeadingRadius: AeroTokens.Radius.xl, topTrailingRadius: AeroTokens.Radius.xl, style: .continuous))
        .shadow(color: .black.opacity(0.25), radius: 20, y: -4)
    }

    private func tile(_ label: String, _ v: (String, String), tone: Tone = .neutral) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label).font(.caption2.weight(.semibold)).foregroundStyle(AeroTokens.textSecondary)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(v.0).font(.system(.title3, design: .rounded).weight(.bold)).monospacedDigit()
                    .foregroundStyle(tone == .neutral ? AeroTokens.textPrimary : tone.color)
                Text(v.1).font(.caption2).foregroundStyle(AeroTokens.textMuted)
            }
            .lineLimit(1).minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(AeroTokens.surfaceElevated, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var altFactor: Double { Units.current == .metric ? 1 : 3.28084 }

    private var profileChart: some View {
        let pts = chartPoints.filter { $0.alt != nil }
        let lo = (pts.compactMap(\.alt).min() ?? 0) * altFactor
        return Chart {
            ForEach(Array(pts.enumerated()), id: \.offset) { _, p in
                AreaMark(x: .value("t", p.t), yStart: .value("min", lo), yEnd: .value("alt", p.alt! * altFactor))
                    .foregroundStyle(LinearGradient(colors: [Brand.accent.opacity(0.35), Brand.accent.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                LineMark(x: .value("t", p.t), y: .value("alt", p.alt! * altFactor))
                    .foregroundStyle(Brand.accent)
                    .lineStyle(StrokeStyle(lineWidth: 1.5))
            }
            RuleMark(x: .value("now", engine.time))
                .foregroundStyle(AeroTokens.textPrimary)
                .lineStyle(StrokeStyle(lineWidth: 1.5))
            if let a = engine.point.alt {
                PointMark(x: .value("now", engine.time), y: .value("alt", a * altFactor))
                    .foregroundStyle(AeroTokens.textPrimary)
                    .symbolSize(40)
            }
        }
        .chartXScale(domain: 0...max(1, engine.track.duration))
        .chartYScale(domain: .automatic(includesZero: false))
        .chartXAxis(.hidden)
        .chartYAxis { AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) }
        .chartOverlay { proxy in
            GeometryReader { geo in
                Rectangle().fill(.clear).contentShape(Rectangle())
                    .gesture(DragGesture(minimumDistance: 0).onChanged { g in
                        guard let frame = proxy.plotFrame else { return }
                        let x = g.location.x - geo[frame].origin.x
                        if let t: Double = proxy.value(atX: x) {
                            engine.pause()
                            engine.seek(t)
                        }
                    })
            }
        }
        .frame(height: 96)
        .accessibilityLabel(Text("İrtifa profili"))
        .accessibilityIdentifier("replay.chart")
    }

    private var transport: some View {
        HStack(spacing: AeroTokens.Space.s4) {
            Button { engine.cycleRate() } label: {
                Text("\(Int(engine.rate))×")
                    .font(.system(.subheadline, design: .rounded).weight(.bold)).monospacedDigit()
                    .frame(width: 52, height: 40)
                    .background(AeroTokens.surfaceElevated, in: Capsule())
            }
            .accessibilityLabel(Text("Hız \(Int(engine.rate))×"))
            .accessibilityIdentifier("replay.rate")
            Spacer()
            Button { engine.skip(-30) } label: { Image(icon: "backward.fill").font(.title3) }
                .accessibilityLabel(Text("30 sn geri"))
            Button { engine.toggle() } label: {
                Image(icon: engine.isPlaying ? "pause.fill" : "play.fill")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(width: 64, height: 64)
                    .background(Brand.gradient, in: Circle())
                    .shadow(color: Brand.accent.opacity(0.4), radius: 10, y: 4)
                    .contentTransition(.symbolEffect(.replace))
            }
            .accessibilityLabel(Text(engine.isPlaying ? "Duraklat" : "Oynat"))
            .accessibilityIdentifier("replay.play")
            Button { engine.skip(30) } label: { Image(icon: "forward.fill").font(.title3) }
                .accessibilityLabel(Text("30 sn ileri"))
            Spacer()
            Color.clear.frame(width: 52, height: 40)
        }
        .foregroundStyle(AeroTokens.textPrimary)
        .buttonStyle(.plain)
    }
}
