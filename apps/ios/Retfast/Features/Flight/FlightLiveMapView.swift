import MapKit
import RetfastCore
import SwiftUI

/// Live map inside the flight computer: own position/heading/path/accuracy,
/// last position the server confirmed, and other pilots the server lets us see.
struct FlightLiveMapView: View {
    @Environment(AppModel.self) private var model
    @State private var camera: MapCameraPosition = .automatic
    @State private var follow = true
    @State private var headingUp = false
    @State private var live: EventLiveModel?
    @State private var lastSynced: TelemetrySample?
    @State private var showPilots = false

    private var v: FlightComputerValues { model.session.values }
    private var own: CLLocationCoordinate2D? {
        guard let lat = v.latitude, let lon = v.longitude else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }
    private var track: [CLLocationCoordinate2D] {
        model.session.track.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }
    }

    var body: some View {
        ZStack(alignment: .top) {
            Map(position: $camera) {
                if track.count > 1 {
                    MapPolyline(coordinates: track).stroke(AeroTokens.primary, lineWidth: 3)
                }
                if let s = lastSynced {
                    Annotation(String(localized: "Son gönderilen"), coordinate: CLLocationCoordinate2D(latitude: s.lat, longitude: s.lon), anchor: .center) {
                        Image(systemName: "checkmark.icloud.fill")
                            .font(.caption).padding(4)
                            .foregroundStyle(AeroTokens.onSecondary)
                            .background(AeroTokens.secondary, in: Circle())
                    }
                }
                ForEach(live?.pilots ?? []) { pilot in
                    if pilot.trail.count > 1 {
                        MapPolyline(coordinates: pilot.trail).stroke(AeroTokens.secondary.opacity(0.6), lineWidth: 2)
                    }
                    if let p = pilot.position {
                        Annotation(pilot.name, coordinate: CLLocationCoordinate2D(latitude: p.lat, longitude: p.lon)) {
                            PilotMarker(freshness: pilot.freshness, simulated: pilot.isSimulated, course: p.courseDeg)
                        }
                    }
                }
                if let own {
                    MapCircle(center: own, radius: max(v.horizontalAccuracy ?? 0, 3))
                        .foregroundStyle(AeroTokens.primary.opacity(0.15))
                        .stroke(AeroTokens.primary.opacity(0.5), lineWidth: 1)
                    Annotation(String(localized: "Ben"), coordinate: own, anchor: .center) {
                        Image(systemName: "location.north.fill")
                            .font(.title2)
                            .foregroundStyle(AeroTokens.primary)
                            .rotationEffect(.degrees(headingUp ? 0 : (v.heading ?? 0)))
                            .shadow(radius: 2)
                            .accessibilityLabel(Text("Konumunuz, yön \(Fmt.heading(v.heading))"))
                    }
                }
            }
            .mapStyle(.standard(elevation: .realistic, pointsOfInterest: .excludingAll))
            .mapControls { MapScaleView(); MapCompass() }
            .simultaneousGesture(DragGesture(minimumDistance: 10).onChanged { _ in follow = false })

            VStack(spacing: AeroTokens.Space.s2) {
                HStack {
                    connectionPill
                    Spacer()
                    SyncBadge(snapshot: model.syncSnapshot)
                }
                if own == nil {
                    StatusPill(String(localized: "Henüz konum yok"), systemImage: "location.slash", tone: .warning)
                }
                Spacer()
                HStack {
                    if let live, !live.pilots.isEmpty {
                        Button { showPilots = true } label: {
                            Label("\(live.pilots.count) pilot", systemImage: "person.2")
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    Spacer()
                    VStack(spacing: AeroTokens.Space.s2) {
                        Button { headingUp.toggle(); recenter() } label: {
                            Image(systemName: headingUp ? "location.north.line.fill" : "location.north.line")
                                .frame(width: 44, height: 44)
                        }
                        .accessibilityLabel(headingUp ? Text("Yön yukarı (kuzey yukarı yap)") : Text("Kuzey yukarı (yön yukarı yap)"))
                        Button { follow = true; recenter() } label: {
                            Image(systemName: follow ? "location.fill" : "location").frame(width: 44, height: 44)
                        }
                        .accessibilityLabel(Text("Konuma ortala"))
                    }
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.md))
                }
            }
            .padding(AeroTokens.Space.s3)
        }
        .onChange(of: v.lastFixAt) { _, _ in
            if follow { recenter() }
        }
        .task(id: model.syncSnapshot.lastServerAck) {
            if let id = model.session.flight?.id { lastSynced = try? model.store.lastSyncedSample(flightId: id) }
        }
        .task {
            recenter()
            guard let eventId = model.session.flight?.eventId?.uuidString.lowercased() else { return }
            let live = EventLiveModel(model: model, eventId: eventId, excludeFlightId: model.session.flight?.id.uuidString.lowercased())
            self.live = live
            await live.start()
        }
        .onDisappear { live?.stop() }
        .sheet(isPresented: $showPilots) {
            NavigationStack {
                List(live?.pilots ?? []) { p in
                    HStack {
                        Text(p.name)
                        if p.isSimulated { SimBadge() }
                        Spacer()
                        FreshnessBadge(freshness: p.freshness, age: p.lastReceivedAt.map { Date().timeIntervalSince($0) })
                    }
                }
                .navigationTitle("Görünen pilotlar")
            }
            .presentationDetents([.medium])
        }
    }

    @ViewBuilder private var connectionPill: some View {
        if model.session.flight?.eventId == nil {
            StatusPill(String(localized: "Etkinlik yok · yalnızca siz"), systemImage: "person", tone: .neutral)
        } else {
            switch live?.connection ?? .disconnected {
            case .connected: StatusPill(String(localized: "Canlı bağlantı"), systemImage: "dot.radiowaves.left.and.right", tone: .active)
            case .connecting: StatusPill(String(localized: "Bağlanıyor"), systemImage: "antenna.radiowaves.left.and.right", tone: .info)
            case .reconnecting: StatusPill(String(localized: "Yeniden bağlanıyor"), systemImage: "arrow.clockwise", tone: .warning)
            case .disconnected: StatusPill(String(localized: "Canlı bağlantı yok"), systemImage: "wifi.slash", tone: .warning)
            }
        }
    }

    private func recenter() {
        guard let own else { return }
        camera = .camera(MapCamera(centerCoordinate: own, distance: 4000, heading: headingUp ? (v.heading ?? 0) : 0, pitch: 0))
    }
}
