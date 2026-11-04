import CoreLocation
import MapKit
import RetfastCore
import SwiftUI

struct EventDetailView: View {
    @Environment(AppModel.self) private var model
    @State var event: Event
    @State private var sites: [LaunchSite] = []
    @State private var sitesError: String?
    @State private var busy = false
    @State private var actionError: String?
    @State private var confirmLeave = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AeroTokens.Space.s4) {
                header
                if let actionError { AeroCard { WarningRow(text: actionError, tone: .error) } }
                membershipActions
                if event.settings?.publicLiveMap ?? false || event.myRole != nil {
                    NavigationLink {
                        EventLiveMapView(event: event)
                    } label: {
                        Label("Canlı harita", systemImage: "map.fill")
                    }
                    .buttonStyle(.aeroPrimary)
                    .accessibilityIdentifier("event.liveMap")
                }
                details
                settings
                launchSites
            }
            .padding(AeroTokens.Space.s4)
        }
        .navigationTitle(event.name)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await reload() }
        .task { await reload() }
        .confirmationDialog("Etkinlikten ayrılmak istiyor musunuz?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Ayrıl", role: .destructive) { Task { await leave() } }
        }
        .aeroBackground()
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: AeroTokens.Space.s2) {
            HStack(spacing: AeroTokens.Space.s2) {
                EventStatusPill(status: event.status)
                if event.isDemo ?? false { DemoBadge() }
                if let role = event.myRole { RolePill(role: role) }
            }
            Text(event.name).font(.title.bold()).foregroundStyle(AeroTokens.textPrimary)
            if let loc = event.locationName, !loc.isEmpty {
                Label(loc, systemImage: "mappin.and.ellipse").foregroundStyle(AeroTokens.textSecondary)
            }
            if let d = event.description, !d.isEmpty {
                Text(d).font(.body).foregroundStyle(AeroTokens.textSecondary)
            }
        }
    }

    @ViewBuilder private var membershipActions: some View {
        let isMember = event.myRole != nil
        if isMember {
            if event.myRole != "organizer" {
                Button(role: .destructive) { confirmLeave = true } label: { Label("Etkinlikten ayrıl", systemImage: "rectangle.portrait.and.arrow.right") }
                    .buttonStyle(.aeroSecondary)
                    .disabled(busy)
            }
        } else if event.settings?.registrationOpen ?? false {
            Button { Task { await join() } } label: {
                if busy { ProgressView() } else { Label("Etkinliğe katıl", systemImage: "person.badge.plus") }
            }
            .buttonStyle(.aeroPrimary)
            .disabled(busy)
            .accessibilityIdentifier("event.join")
        } else {
            AeroCard {
                Label("Kayıt kapalı. Katılmak için organizatörle iletişime geçin.", systemImage: "lock")
                    .font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
            }
        }
    }

    private var details: some View {
        AeroCard {
            SectionHeader(title: String(localized: "Bilgiler"))
            KeyValueRow(key: String(localized: "Tür"), value: kindText)
            KeyValueRow(key: String(localized: "Görünürlük"), value: event.visibility == "restricted" ? String(localized: "Kısıtlı (yalnızca üyeler)") : String(localized: "Herkese açık"))
            KeyValueRow(key: String(localized: "Başlangıç"), value: Fmt.dateTime(event.startsAt))
            KeyValueRow(key: String(localized: "Bitiş"), value: Fmt.dateTime(event.endsAt))
            KeyValueRow(key: String(localized: "Merkez"), value: Fmt.coordinate(event.center?.lat, event.center?.lon), mono: true)
            if event.center != nil, event.centerIsApproximate ?? false {
                WarningRow(text: String(localized: "Merkez konumu yaklaşıktır; kalkış alanı konumu olarak kullanmayın."), tone: .warning, systemImage: "scope")
            }
            KeyValueRow(key: String(localized: "Organizatör"), value: event.organizer?.fullName ?? Fmt.dash)
            KeyValueRow(key: String(localized: "Katılımcı"), value: event.participantCount.map(String.init) ?? Fmt.dash)
            KeyValueRow(key: String(localized: "Rolüm"), value: roleText)
        }
    }

    private var settings: some View {
        AeroCard {
            SectionHeader(title: String(localized: "Etkinlik ayarları"))
            settingRow("Kayıt açık", event.settings?.registrationOpen)
            settingRow("Canlı takip", event.settings?.liveTracking)
            settingRow("Uçuş kaydı", event.settings?.flightRecording)
            settingRow("Gözlemcilere açık", event.settings?.observersAllowed)
            settingRow("Acil durum testi (TEST SOS)", event.settings?.emergencyTesting)
            settingRow("Herkese açık canlı harita", event.settings?.publicLiveMap)
        }
    }

    private func settingRow(_ title: LocalizedStringKey, _ value: Bool?) -> some View {
        HStack {
            Text(title).foregroundStyle(AeroTokens.textPrimary)
            Spacer()
            switch value {
            case true?: Label("Evet", systemImage: "checkmark.circle.fill").foregroundStyle(AeroTokens.success)
            case false?: Label("Hayır", systemImage: "xmark.circle").foregroundStyle(AeroTokens.textSecondary)
            case nil: Label("Bilinmiyor", systemImage: "questionmark.circle").foregroundStyle(AeroTokens.textMuted)
            }
        }
        .font(.subheadline)
        .accessibilityElement(children: .combine)
    }

    private var launchSites: some View {
        AeroCard {
            SectionHeader(title: String(localized: "Kalkış alanları"))
            if let sitesError {
                WarningRow(text: sitesError, tone: .error)
            } else if sites.isEmpty {
                Text("Kayıtlı kalkış alanı yok.").font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
            }
            ForEach(sites) { site in
                VStack(alignment: .leading, spacing: 4) {
                    Text(site.name).font(.headline)
                    LaunchSiteBadges(site: site)
                    if let p = site.position {
                        Text(Fmt.coordinate(p.lat, p.lon)).font(.caption.monospaced()).foregroundStyle(AeroTokens.textSecondary)
                            .textSelection(.enabled)
                    }
                    if let notes = site.notes, !notes.isEmpty {
                        Text(notes).font(.caption).foregroundStyle(AeroTokens.textSecondary)
                    }
                }
                .padding(.vertical, 4)
                if site.id != sites.last?.id { Divider() }
            }
        }
    }

    private var kindText: String {
        event.kind == "paragliding" ? String(localized: "Yamaç paraşütü") : (event.kind ?? Fmt.dash)
    }

    private var roleText: String {
        switch event.myRole {
        case "organizer": String(localized: "Organizatör")
        case "participant": String(localized: "Katılımcı")
        case "observer": String(localized: "Gözlemci")
        default: String(localized: "Üye değil")
        }
    }

    // MARK: Actions

    private func reload() async {
        if let fresh = try? await model.api.event(event.id) { event = fresh }
        do {
            sites = try await model.api.launchSites(eventId: event.id)
            sitesError = nil
        } catch {
            sitesError = ErrorText.message(error)
        }
    }

    private func join() async {
        busy = true; defer { busy = false }
        do {
            try await model.api.joinEvent(event.id)
            actionError = nil
            await reload()
            await model.refreshEvents()
        } catch {
            actionError = ErrorText.message(error)
        }
    }

    private func leave() async {
        busy = true; defer { busy = false }
        do {
            try await model.api.leaveEvent(event.id)
            actionError = nil
            await reload()
            await model.refreshEvents()
        } catch {
            actionError = ErrorText.message(error)
        }
    }
}

/// Public / member live map of one event.
struct EventLiveMapView: View {
    @Environment(AppModel.self) private var model
    let event: Event
    @State private var live: LiveMapModel?
    @State private var showList = false
    @State private var camera: MapCameraPosition = .automatic

    var body: some View {
        ZStack(alignment: .top) {
            Map(position: $camera) {
                if let center = event.center, live?.pilots.isEmpty ?? true {
                    Marker(event.name, systemImage: "flag", coordinate: CLLocationCoordinate2D(latitude: center.lat, longitude: center.lon))
                }
                ForEach(live?.pilots ?? []) { pilot in
                    if pilot.trail.count > 1 {
                        MapPolyline(coordinates: pilot.trail)
                            .stroke(pilot.freshness == "live" ? AeroTokens.trackingActive : AeroTokens.trackingStale, lineWidth: 2)
                    }
                    if let c = pilot.coordinate {
                        Annotation(pilot.name, coordinate: c) {
                            LivePilotMarker(pilot: pilot)
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

            VStack(spacing: AeroTokens.Space.s2) {
                HStack {
                    ConnectionPill(state: live?.connection ?? .disconnected)
                    Spacer()
                    if let last = live?.lastUpdate {
                        StatusPill(String(localized: "Güncelleme \(Fmt.time(last))"), systemImage: "clock", tone: .neutral)
                    }
                }
                if let error = live?.error {
                    WarningRow(text: error, tone: .error)
                        .padding(AeroTokens.Space.s2)
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.sm))
                }
            }
            .padding(AeroTokens.Space.s3)
        }
        .navigationTitle("Canlı harita")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showList = true } label: {
                    Label("Pilotlar (\(live?.pilots.count ?? 0))", systemImage: "person.3")
                }
            }
        }
        .sheet(isPresented: $showList) {
            NavigationStack {
                PilotListView(pilots: live?.pilots ?? []) { pilot in
                    if let c = pilot.coordinate {
                        camera = .region(MKCoordinateRegion(center: c, latitudinalMeters: 3000, longitudinalMeters: 3000))
                    }
                    showList = false
                }
                .navigationTitle("Pilotlar")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Kapat") { showList = false } } }
            }
            .presentationDetents([.medium, .large])
        }
        .task {
            let m = LiveMapModel(model: model, eventId: event.id)
            live = m
            await m.start()
        }
        .onDisappear { live?.stop() }
    }
}

struct LivePilotMarker: View {
    let pilot: LiveMapModel.PilotState
    var body: some View {
        VStack(spacing: 2) {
            Image(systemName: pilot.freshness == "live" ? "location.north.circle.fill" : "location.slash.circle.fill")
                .rotationEffect(.degrees(pilot.position?.courseDeg ?? 0))
                .font(.title2)
                .foregroundStyle(pilot.freshness == "live" ? AeroTokens.trackingActive : (pilot.freshness == "stale" ? AeroTokens.trackingStale : AeroTokens.offline))
                .background(Circle().fill(AeroTokens.surface))
            HStack(spacing: 2) {
                Text(pilot.name).font(.caption2.weight(.semibold)).lineLimit(1)
                if pilot.isSimulated { SimBadge() }
            }
            .padding(.horizontal, 4)
            .background(AeroTokens.surface.opacity(0.9), in: Capsule())
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(pilot.name), \(pilot.freshness)"))
    }
}

struct PilotListView: View {
    let pilots: [LiveMapModel.PilotState]
    var onSelect: (LiveMapModel.PilotState) -> Void

    var body: some View {
        List {
            if pilots.isEmpty {
                Text("Şu anda görünür pilot yok.").foregroundStyle(AeroTokens.textSecondary)
            }
            ForEach(pilots) { pilot in
                Button { onSelect(pilot) } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 4) {
                                Text(pilot.name).font(.headline).foregroundStyle(AeroTokens.textPrimary)
                                if pilot.isSimulated { SimBadge() }
                            }
                            let alt = Fmt.altitude(pilot.position?.gpsAltM)
                            Text("GPS irtifa \(alt.0) \(alt.1) · \(Fmt.accuracy(pilot.position?.hAccM))")
                                .font(.caption.monospacedDigit()).foregroundStyle(AeroTokens.textSecondary)
                        }
                        Spacer()
                        FreshnessBadge(freshness: pilot.freshness, age: pilot.age())
                    }
                }
            }
        }
    }
}

struct ConnectionPill: View {
    let state: RealtimeConnectionState
    var body: some View {
        switch state {
        case .connected: StatusPill(String(localized: "Canlı bağlı"), systemImage: "bolt.horizontal.circle", tone: .active)
        case .connecting: StatusPill(String(localized: "Bağlanıyor"), systemImage: "arrow.triangle.2.circlepath", tone: .info)
        case .reconnecting(let attempt, _): StatusPill(String(localized: "Yeniden bağlanıyor (\(attempt))"), systemImage: "arrow.triangle.2.circlepath", tone: .warning)
        case .disconnected: StatusPill(String(localized: "Bağlantı yok"), systemImage: "bolt.horizontal.circle.fill", tone: .error)
        }
    }
}
