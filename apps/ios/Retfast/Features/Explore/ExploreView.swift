import CoreLocation
import MapKit
import RetfastCore
import SwiftUI

struct ExploreView: View {
    @Environment(AppModel.self) private var model

    enum Filter: String, CaseIterable, Identifiable {
        case active, upcoming, all
        var id: String { rawValue }
        var title: LocalizedStringKey {
            switch self {
            case .active: "Aktif"
            case .upcoming: "Yaklaşan"
            case .all: "Tümü"
            }
        }
        var statuses: [String] {
            switch self {
            case .active: ["active"]
            case .upcoming: ["published"]
            case .all: ["active", "published"]
            }
        }
    }

    struct NearbySite: Identifiable {
        let site: LaunchSite
        let event: Event
        let distance: Double?
        var id: String { site.id }
    }

    @State private var filter: Filter = .all
    @State private var query = ""
    @State private var showMap = false
    @State private var events: [Event] = []
    @State private var loading = false
    @State private var error: String?
    @State private var loaded = false
    @State private var nearby: [NearbySite] = []
    @State private var nearbyState: NearbyState = .idle
    @State private var locator = OneShotLocation()

    enum NearbyState: Equatable { case idle, noPermission, loading, done, failed }

    var body: some View {
        Group {
            if showMap { mapContent } else { listContent }
        }
        .navigationTitle("Keşfet")
        .searchable(text: $query, prompt: Text("Etkinlik ara"))
        .onSubmit(of: .search) { Task { await load() } }
        .onChange(of: query) { _, new in if new.isEmpty { Task { await load() } } }
        .onChange(of: filter) { _, _ in Task { await load() } }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Picker("Görünüm", selection: $showMap) {
                    Label("Liste", systemImage: "list.bullet").tag(false)
                    Label("Harita", systemImage: "map").tag(true)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("explore.viewToggle")
            }
        }
        .navigationDestination(for: Event.self) { EventDetailView(event: $0) }
        .task {
            guard !loaded else { return }
            loaded = true
            await load()
            await loadNearby()
        }
        .refreshable {
            await load()
            await loadNearby()
        }
        .aeroBackground()
    }

    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: AeroTokens.Space.s2) {
                ForEach(Filter.allCases) { f in
                    Button {
                        filter = f
                    } label: {
                        Label { Text(f.title) } icon: { Image(systemName: filter == f ? "checkmark" : "circle") }
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, AeroTokens.Space.s3)
                            .padding(.vertical, AeroTokens.Space.s2)
                            .foregroundStyle(filter == f ? AeroTokens.onPrimary : AeroTokens.textPrimary)
                            .background(filter == f ? AeroTokens.primary : AeroTokens.surface, in: Capsule())
                            .overlay(Capsule().strokeBorder(AeroTokens.border, lineWidth: filter == f ? 0 : 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(filter == f ? .isSelected : [])
                }
            }
            .padding(.horizontal, AeroTokens.Space.s4)
        }
    }

    // MARK: List

    private var listContent: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: AeroTokens.Space.s3) {
                filterChips.padding(.horizontal, -AeroTokens.Space.s4)
                if let error {
                    AeroCard {
                        WarningRow(text: error, tone: .error, systemImage: model.networkStatus.isConnected ? "exclamationmark.triangle.fill" : "wifi.slash")
                        Button("Tekrar dene") { Task { await load() } }.buttonStyle(.aeroSecondary)
                    }
                }
                if loading && events.isEmpty {
                    ProgressView().frame(maxWidth: .infinity).padding()
                } else if events.isEmpty && error == nil && loaded {
                    AeroCard {
                        Label("Bu filtreye uyan etkinlik yok.", systemImage: "calendar.badge.exclamationmark")
                            .foregroundStyle(AeroTokens.textSecondary)
                    }
                }
                ForEach(events) { event in
                    NavigationLink(value: event) { EventRow(event: event) }
                        .buttonStyle(.plain)
                }
                nearbySection
            }
            .padding(AeroTokens.Space.s4)
        }
    }

    @ViewBuilder private var nearbySection: some View {
        SectionHeader(title: String(localized: "Yakındaki kalkış alanları"))
            .padding(.top, AeroTokens.Space.s4)
        switch nearbyState {
        case .noPermission, .idle:
            AeroCard {
                Label("Yakındaki kalkış alanlarını görmek için konum izni gerekir. İzin, uçuş öncesi kontrolde istenir.", systemImage: "location.slash")
                    .font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
            }
        case .loading:
            ProgressView().frame(maxWidth: .infinity)
        case .failed:
            AeroCard { WarningRow(text: String(localized: "Yakındaki kalkış alanları yüklenemedi.")) }
        case .done:
            if nearby.isEmpty {
                AeroCard {
                    Label("100 km içinde kayıtlı kalkış alanı yok.", systemImage: "mappin.slash")
                        .font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
                }
            }
            ForEach(nearby) { item in
                NavigationLink(value: item.event) {
                    AeroCard {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.site.name).font(.headline).foregroundStyle(AeroTokens.textPrimary)
                                Text(item.event.name).font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
                                LaunchSiteBadges(site: item.site)
                            }
                            Spacer()
                            if let d = item.distance {
                                let f = Fmt.distance(d)
                                Text("\(f.0) \(f.1)").font(.subheadline.monospacedDigit()).foregroundStyle(AeroTokens.textSecondary)
                            }
                        }
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: Map

    private var mapContent: some View {
        VStack(spacing: 0) {
            filterChips.padding(.vertical, AeroTokens.Space.s2)
            Map {
                ForEach(events.filter { $0.center != nil }) { event in
                    let c = CLLocationCoordinate2D(latitude: event.center!.lat, longitude: event.center!.lon)
                    if event.centerIsApproximate ?? false {
                        MapCircle(center: c, radius: 3000)
                            .foregroundStyle(AeroTokens.secondary.opacity(0.15))
                            .stroke(AeroTokens.secondary, lineWidth: 1)
                    }
                    Annotation(event.name, coordinate: c) {
                        NavigationLink(value: event) {
                            VStack(spacing: 2) {
                                Image(systemName: event.status == "active" ? "paperplane.circle.fill" : "calendar.circle.fill")
                                    .font(.title)
                                    .foregroundStyle(event.status == "active" ? AeroTokens.trackingActive : AeroTokens.secondary)
                                    .background(Circle().fill(AeroTokens.surface))
                                if event.centerIsApproximate ?? false {
                                    Text("yaklaşık").font(.caption2.weight(.semibold))
                                        .padding(.horizontal, 4)
                                        .background(AeroTokens.surface, in: Capsule())
                                }
                            }
                        }
                    }
                }
                ForEach(nearby.filter { $0.site.position != nil }) { item in
                    Marker(item.site.name, systemImage: "arrow.up.right.circle",
                           coordinate: CLLocationCoordinate2D(latitude: item.site.position!.lat, longitude: item.site.position!.lon))
                        .tint(AeroTokens.primary)
                }
                UserAnnotation()
            }
            .mapControls {
                MapUserLocationButton()
                MapCompass()
                MapScaleView()
            }
            .overlay(alignment: .bottom) {
                let missing = events.filter { $0.center == nil }.count
                if missing > 0 {
                    StatusPill(String(localized: "\(missing) etkinliğin konumu yok, haritada gösterilmiyor"), systemImage: "mappin.slash", tone: .neutral)
                        .padding()
                        .background(.thinMaterial, in: Capsule())
                        .padding()
                }
            }
        }
    }

    // MARK: Loading

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            events = try await model.api.events(status: filter.statuses, query: query.isEmpty ? nil : query).items
            error = nil
        } catch {
            self.error = model.networkStatus.isConnected
                ? ErrorText.message(error)
                : String(localized: "Çevrimdışısınız. Etkinlik listesi bağlantı gelince yüklenecek.")
        }
    }

    private func loadNearby() async {
        guard locator.isAuthorized else { nearbyState = .noPermission; return }
        nearbyState = .loading
        guard let here = await locator.current() else { nearbyState = .failed; return }
        let center = LatLon(lat: here.coordinate.latitude, lon: here.coordinate.longitude)
        do {
            let nearEvents = try await model.api.events(status: ["active", "published"], near: center, radiusKm: 100).items
            var sites: [NearbySite] = []
            for event in nearEvents.prefix(5) {
                let list = (try? await model.api.launchSites(eventId: event.id)) ?? []
                for site in list {
                    let d = site.position.map { here.distance(from: CLLocation(latitude: $0.lat, longitude: $0.lon)) }
                    sites.append(NearbySite(site: site, event: event, distance: d))
                }
            }
            nearby = sites.sorted { ($0.distance ?? .greatestFiniteMagnitude) < ($1.distance ?? .greatestFiniteMagnitude) }
            nearbyState = .done
        } catch {
            nearbyState = .failed
        }
    }
}

struct EventRow: View {
    let event: Event

    var body: some View {
        AeroCard {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: AeroTokens.Space.s1) {
                    HStack(spacing: AeroTokens.Space.s2) {
                        Text(event.name).font(.headline).foregroundStyle(AeroTokens.textPrimary)
                        if event.isDemo ?? false { DemoBadge() }
                    }
                    if let loc = event.locationName, !loc.isEmpty {
                        Label(loc, systemImage: "mappin.and.ellipse").font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
                    }
                    Text(EventDates.range(event)).font(.caption).foregroundStyle(AeroTokens.textMuted)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: AeroTokens.Space.s1) {
                    EventStatusPill(status: event.status)
                    if let role = event.myRole { RolePill(role: role) }
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

struct EventStatusPill: View {
    let status: String
    var body: some View {
        switch status {
        case "active": StatusPill(String(localized: "Aktif"), systemImage: "dot.radiowaves.left.and.right", tone: .active)
        case "published": StatusPill(String(localized: "Yaklaşan"), systemImage: "calendar", tone: .info)
        case "completed": StatusPill(String(localized: "Tamamlandı"), systemImage: "checkmark.circle", tone: .neutral)
        case "archived": StatusPill(String(localized: "Arşivlendi"), systemImage: "archivebox", tone: .neutral)
        case "draft": StatusPill(String(localized: "Taslak"), systemImage: "pencil", tone: .neutral)
        default: StatusPill(status, systemImage: "questionmark.circle", tone: .neutral)
        }
    }
}

struct RolePill: View {
    let role: String
    var body: some View {
        switch role {
        case "organizer": StatusPill(String(localized: "Organizatör"), systemImage: "star", tone: .info)
        case "participant": StatusPill(String(localized: "Katılımcı"), systemImage: "person.fill.checkmark", tone: .success)
        case "observer": StatusPill(String(localized: "Gözlemci"), systemImage: "eye", tone: .neutral)
        default: StatusPill(role, systemImage: "person", tone: .neutral)
        }
    }
}

struct DemoBadge: View {
    var body: some View {
        Text("DEMO")
            .font(.caption2.weight(.heavy).monospaced())
            .padding(.horizontal, 6).padding(.vertical, 2)
            .foregroundStyle(AeroTokens.onSecondary)
            .background(AeroTokens.secondary, in: RoundedRectangle(cornerRadius: 4))
            .accessibilityLabel(Text("Demo etkinlik"))
    }
}

struct LaunchSiteBadges: View {
    let site: LaunchSite
    var body: some View {
        HStack(spacing: AeroTokens.Space.s1) {
            if site.position == nil {
                StatusPill(String(localized: "konum doğrulanmadı"), systemImage: "mappin.slash", tone: .warning)
            } else if !(site.isVerified ?? false) {
                StatusPill(String(localized: "doğrulanmamış"), systemImage: "questionmark.circle", tone: .warning)
            } else {
                StatusPill(String(localized: "doğrulandı"), systemImage: "checkmark.seal", tone: .success)
            }
            if let e = site.elevationM {
                let a = Fmt.altitude(e)
                Text("\(a.0) \(a.1)").font(.caption.monospacedDigit()).foregroundStyle(AeroTokens.textSecondary)
            }
        }
    }
}

enum EventDates {
    static func range(_ e: Event) -> String {
        switch (e.startsAt, e.endsAt) {
        case let (s?, end?): "\(s.formatted(date: .abbreviated, time: .omitted)) – \(end.formatted(date: .abbreviated, time: .omitted))"
        case let (s?, nil): s.formatted(date: .abbreviated, time: .shortened)
        default: Fmt.dash
        }
    }
}
