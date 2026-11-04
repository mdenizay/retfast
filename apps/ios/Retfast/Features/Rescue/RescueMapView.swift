import CoreLocation
import MapKit
import RetfastCore
import SwiftUI

/// All active incidents + rescue team last positions.
struct RescueMapView: View {
    @Environment(AppModel.self) private var model
    @State private var incidents: [Incident] = []
    @State private var team: [TeamMember] = []
    @State private var error: String?
    @State private var camera: MapCameraPosition = .automatic
    @State private var selected: Incident?

    var body: some View {
        TimelineView(.periodic(from: .now, by: 5)) { ctx in
            Map(position: $camera) {
                ForEach(incidents) { inc in
                    if let c = inc.bestCoordinate {
                        if let acc = inc.position?.hAccM, acc > 0 {
                            MapCircle(center: c, radius: acc).foregroundStyle(AeroTokens.emergency.opacity(0.15))
                        }
                        Annotation(inc.pilotName, coordinate: c) {
                            Button { selected = inc } label: {
                                VStack(spacing: 2) {
                                    Image(systemName: "sos.circle.fill").font(.title)
                                        .foregroundStyle(AeroTokens.emergency)
                                        .background(Circle().fill(.white))
                                    staleLabel(inc.lastFixTime.map { ctx.date.timeIntervalSince($0) })
                                    if inc.isTest ?? false { TestBadge() }
                                }
                            }
                            .accessibilityLabel(Text("SOS \(inc.pilotName)"))
                        }
                    }
                }
                ForEach(team) { m in
                    if let p = m.lastPosition {
                        Annotation(m.fullName ?? "", coordinate: CLLocationCoordinate2D(latitude: p.lat, longitude: p.lon)) {
                            VStack(spacing: 2) {
                                Image(systemName: "cross.case.circle.fill").font(.title2)
                                    .foregroundStyle(AeroTokens.secondary)
                                    .background(Circle().fill(AeroTokens.surface))
                                staleLabel(p.t.map { ctx.date.timeIntervalSince($0) })
                            }
                        }
                    }
                }
                UserAnnotation()
            }
            .mapControls {
                MapUserLocationButton()
                MapCompass()
                MapScaleView()
            }
        }
        .overlay(alignment: .top) {
            if let error {
                WarningRow(text: error, tone: .error)
                    .padding(AeroTokens.Space.s2)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.sm))
                    .padding()
            }
        }
        .navigationTitle("Kurtarma haritası")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { withAnimation { camera = .automatic } } label: { Label("Ortala", systemImage: "scope") }
            }
        }
        .navigationDestination(item: $selected) { IncidentDetailView(incident: $0) }
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(nanoseconds: 15_000_000_000)
            }
        }
    }

    @ViewBuilder private func staleLabel(_ age: TimeInterval?) -> some View {
        if let age {
            let f = FreshnessBadge.freshness(age: age)
            Label(Fmt.age(age), systemImage: f == "live" ? "dot.radiowaves.left.and.right" : (f == "stale" ? "clock.badge.exclamationmark" : "antenna.radiowaves.left.and.right.slash"))
                .font(.caption2.weight(.semibold))
                .padding(.horizontal, 4)
                .background(AeroTokens.surface.opacity(0.9), in: Capsule())
                .foregroundStyle(f == "live" ? AeroTokens.textPrimary : (f == "stale" ? AeroTokens.warning : AeroTokens.error))
        } else {
            Label("konum yok", systemImage: "location.slash")
                .font(.caption2).padding(.horizontal, 4)
                .background(AeroTokens.surface.opacity(0.9), in: Capsule())
        }
    }

    private func load() async {
        do {
            incidents = try await model.api.incidents(status: ["open", "acknowledged", "responding"])
            error = nil
        } catch {
            self.error = RescueText.message(error)
        }
        if let t = try? await model.api.rescueTeam() { team = t }
    }
}

