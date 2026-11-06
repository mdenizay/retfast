import MapKit
import RetfastCore
import SwiftUI

/// Map-first event screen with a role-specific bottom sheet.
struct EventScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let eventId: String
    @State private var event: Event?
    @State private var sites: [LaunchSite] = []
    @State private var live: EventLiveModel?
    @State private var detent: SheetDetent = .half
    @State private var loadError: String?
    @State private var camera: MapCameraPosition = .automatic
    @State private var cameraSet = false
    @State private var preflightDone = false
    /// Map height covered by the sheet; keeps centring above it.
    @State private var sheetCover: CGFloat = 0

    var body: some View {
        ZStack(alignment: .top) {
            if let event {
                EventMapView(event: event, live: live, camera: $camera)
                    .safeAreaPadding(.bottom, sheetCover)
                    .ignoresSafeArea(edges: .bottom)
                mapOverlay(event)
                BottomSheet(detent: $detent) {
                    EventSheetHeader(event: event)
                } content: {
                    sheetContent(event)
                }
                .onPreferenceChange(SheetCoverKey.self) { h in
                    withAnimation(.smooth(duration: 0.3)) { sheetCover = h }
                }
            } else if let loadError {
                ContentUnavailableView {
                    Label("Etkinlik açılamadı", icon: "exclamationmark.triangle")
                } description: { Text(loadError) } actions: {
                    Button("Tekrar dene") { Task { await load() } }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            if let event, showsPreflight(event) {
                PreFlightView(event: event, onBack: { dismiss() }) {
                    withAnimation(.snappy) { preflightDone = true }
                }
                .transition(.move(edge: .leading))
            }
            if event == nil {
                MapCircleButton(systemImage: "arrow.left", label: "Geri") { dismiss() }
                    .padding(.horizontal, AeroTokens.Space.s4).padding(.top, AeroTokens.Space.s2)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .task { await load() }
        .onDisappear { live?.stop() }
        .aeroBackground()
    }

    /// Pilots get the pre-flight checklist first, unless a flight or retrieve is already under way.
    private func showsPreflight(_ event: Event) -> Bool {
        guard !preflightDone, case .pilot = EventSheetMode.mode(for: event) else { return false }
        return !model.session.isActive && model.activeRetrieval(eventId: event.id) == nil
    }

    @ViewBuilder private func mapOverlay(_ event: Event) -> some View {
        HStack(alignment: .top) {
            MapCircleButton(systemImage: "arrow.left", label: "Geri") { dismiss() }
                .accessibilityIdentifier("event.back")
            Spacer()
            if let live { ConnectionPill(state: live.connection).padding(.top, 10) }
            Spacer()
            VStack(spacing: AeroTokens.Space.s2) {
                MapCircleButton(systemImage: "location.fill", label: "Konumuma git") { camera = .userLocation(fallback: camera) }
                MapCircleButton(systemImage: "scope", label: "Etkinliği ortala") { fitEvent(event) }
            }
        }
        .padding(.horizontal, AeroTokens.Space.s4)
        .padding(.top, AeroTokens.Space.s2)
    }

    @ViewBuilder private func sheetContent(_ event: Event) -> some View {
        VStack(alignment: .leading, spacing: AeroTokens.Space.s3) {
            if let error = live?.error { AeroCard { WarningRow(text: error) } }
            switch EventSheetMode.mode(for: event) {
            case .pilot:
                PilotSheet(event: event, live: live) { lat, lon in
                    withAnimation(.smooth(duration: 0.6)) {
                        camera = .camera(MapCamera(centerCoordinate: CLLocationCoordinate2D(latitude: lat, longitude: lon), distance: 3000))
                    }
                }
            case .retriever:
                if let board = model.retrieverBoard, board.eventId == event.id.lowercased() {
                    RetrieverSheet(event: event, board: board, live: live)
                } else {
                    ProgressView()
                }
            case .observer, .organizerOnly:
                ObserverSheet(event: event, live: live)
            case .notMember(let state):
                ApplySheet(event: event, state: state) { await load() }
            }
            if EventSheetMode.showsOrganizerTools(event) {
                OrganizerToolsCard(event: event)
            }
            WeatherCard(event: event)
            EventInfoCard(event: event, live: live)
        }
    }

    private func load() async {
        if event == nil { event = model.event(id: eventId) }
        do {
            let fresh = try await model.api.event(eventId)
            event = fresh
            model.update(event: fresh)
            loadError = nil
        } catch {
            if event == nil { loadError = ErrorText.message(error) }
        }
        guard let event else { return }
        if event.memberRole == .retriever { _ = model.board(for: event) }
        if let s = try? await model.api.launchSites(eventId: event.id) { sites = s }
        if !cameraSet { fitEvent(event); cameraSet = true }
        if live == nil, event.isMember || (event.settings?.publicLiveMap ?? false) {
            let l = EventLiveModel(model: model, eventId: event.id,
                                   excludeFlightId: model.session.flight?.id.uuidString,
                                   subscribePositions: EventSheetMode.showsPilotLayer(event))
            wire(l, event: event)
            live = l
            await l.start()
        }
    }

    private func wire(_ l: EventLiveModel, event: Event) {
        let retrievals = model.retrievals
        let board = event.memberRole == .retriever ? model.retrieverBoard : nil
        l.onRetrieval = { r in
            Task { await retrievals.apply(r) }
            board?.apply(r)
        }
        l.onRetrievalsSnapshot = { list in
            if let board { board.apply(list) }
        }
        l.onPilotPosition = { e in board?.apply(e) }
    }

    private func fitEvent(_ event: Event) {
        var coords = sites.compactMap { $0.position.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) } }
        if let c = event.center { coords.append(CLLocationCoordinate2D(latitude: c.lat, longitude: c.lon)) }
        guard let first = coords.first else { camera = .userLocation(fallback: .automatic); return }
        var rect = MKMapRect(origin: MKMapPoint(first), size: MKMapSize(width: 0, height: 0))
        for c in coords { rect = rect.union(MKMapRect(origin: MKMapPoint(c), size: MKMapSize(width: 0, height: 0))) }
        let pad = max(rect.size.width, rect.size.height, 8000) * 0.6
        camera = .rect(rect.insetBy(dx: -pad, dy: -pad))
    }
}

/// The event map: centre, launch sites, pilots (if allowed), retrievals, retrievers, me.
struct EventMapView: View {
    @Environment(AppModel.self) private var model
    let event: Event
    let live: EventLiveModel?
    @Binding var camera: MapCameraPosition

    private var isMyFlightHere: Bool {
        model.session.isActive && model.session.flight?.eventId?.uuidString.lowercased() == event.id.lowercased()
    }

    var body: some View {
        Map(position: $camera) {
            if let me = myPosition {
                Annotation(String(localized: "Ben"), coordinate: me.coordinate, anchor: .center) {
                    HeadingMarker(course: me.course, tint: isRetriever ? AeroTokens.retrieval : AeroTokens.primary,
                                  shape: isRetriever ? .triangle : .arrow, isMe: true)
                }
                .annotationTitles(.hidden)
            } else {
                UserAnnotation()
            }
            if let c = event.center {
                Annotation(event.centerIsApproximate ?? false ? String(localized: "Etkinlik (yaklaşık)") : String(localized: "Etkinlik"),
                           coordinate: CLLocationCoordinate2D(latitude: c.lat, longitude: c.lon)) {
                    Image(icon: "flag.fill").font(.caption).padding(5)
                        .foregroundStyle(AeroTokens.onSecondary).background(AeroTokens.secondary, in: Circle())
                }
            }
            if isMyFlightHere, model.session.track.count > 1 {
                MapPolyline(coordinates: model.session.track.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) })
                    .stroke(AeroTokens.primary, lineWidth: 3)
            }
            if EventSheetMode.showsPilotLayer(event) {
                ForEach(live?.pilots ?? []) { p in
                    if p.trail.count > 1 {
                        MapPolyline(coordinates: p.trail).stroke(AeroTokens.secondary.opacity(0.5), lineWidth: 2)
                    }
                    if let c = p.coordinate {
                        Annotation(p.name, coordinate: c, anchor: .center) {
                            PilotMarker(freshness: p.freshness, simulated: p.isSimulated, course: p.position?.courseDeg)
                        }
                    }
                }
            }
            ForEach(visibleRetrievals) { r in
                if let pos = r.latestPilotPosition {
                    Annotation(r.pilot?.fullName ?? String(localized: "Pilot"), coordinate: pos.coordinate) {
                        RetrievalPin(status: r.retrievalStatus ?? .requested)
                    }
                }
                if let rp = r.retrieverPosition, r.retrievalStatus == .accepted || r.retrievalStatus == .pickedUp {
                    if let pos = r.latestPilotPosition, r.retrievalStatus == .accepted {
                        MapPolyline(coordinates: [rp.coordinate, pos.coordinate])
                            .stroke(AeroTokens.secondary, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                    }
                    Annotation(r.retriever?.fullName ?? String(localized: "Retriever"), coordinate: rp.coordinate, anchor: .center) {
                        RetrieverPin(course: rp.courseDeg)
                    }
                }
            }
            ForEach(otherRetrievers) { r in
                if let p = r.position {
                    Annotation(r.fullName ?? String(localized: "Retriever"), coordinate: p.coordinate, anchor: .center) {
                        RetrieverPin(onDuty: r.onDuty ?? false, course: p.courseDeg)
                    }
                }
            }
        }
        .mapStyle(.standard(elevation: .realistic, pointsOfInterest: .excludingAll))
        .mapControls { MapScaleView(); MapCompass() }
    }

    private var isRetriever: Bool { event.memberRole == .retriever }

    /// Own position with course: the flight computer while flying here, else
    /// the sharing fix (retriever duty). Nil falls back to the system dot.
    private var myPosition: (coordinate: CLLocationCoordinate2D, course: Double?)? {
        let v = model.session.values
        if isMyFlightHere, let lat = v.latitude, let lon = v.longitude {
            return (CLLocationCoordinate2D(latitude: lat, longitude: lon), v.heading)
        }
        if model.sharing.mode != .off, let f = model.sharing.lastFix, Date().timeIntervalSince(f.timestamp) < 120 {
            return (CLLocationCoordinate2D(latitude: f.latitude, longitude: f.longitude), f.course >= 0 ? f.course : nil)
        }
        return nil
    }

    /// Server already filters per role; retrievers additionally use their board.
    private var visibleRetrievals: [Retrieval] {
        if event.memberRole == .retriever, let board = model.retrieverBoard, board.eventId == event.id.lowercased() {
            return board.openRequests + board.myPickups
        }
        return live?.openRetrievals ?? []
    }

    /// Retrievers not already drawn as part of an accepted retrieval.
    private var otherRetrievers: [LiveRetriever] {
        let shown = Set(visibleRetrievals.compactMap { $0.retrieverPosition != nil ? $0.retriever?.userId : nil })
        return (live?.retrievers ?? []).filter { !shown.contains($0.userId) && $0.userId != model.me?.id }
    }
}

/// Direction marker: a paper-plane style arrow for pilots, a triangle for
/// retrievers (cars). Points to the course; a dot when it is unknown.
struct HeadingMarker: View {
    enum Shape { case arrow, triangle }
    let course: Double?
    var tint: Color
    var shape: Shape = .arrow
    var isMe = false
    var dimmed = false

    var body: some View {
        ZStack {
            if isMe {
                Circle().fill(tint.opacity(0.18)).frame(width: 44, height: 44)
            }
            if let course {
                MarkerShape(kind: shape)
                .fill(dimmed ? AeroTokens.offline : tint)
                .overlay { MarkerShape(kind: shape).stroke(.white, lineWidth: 2) }
                .frame(width: 22, height: 26)
                .rotationEffect(.degrees(course))
                .shadow(color: .black.opacity(0.3), radius: 2, y: 1)
            } else {
                Circle().fill(dimmed ? AeroTokens.offline : tint).frame(width: 16, height: 16)
                    .overlay(Circle().stroke(.white, lineWidth: 2.5))
                    .shadow(color: .black.opacity(0.3), radius: 2, y: 1)
            }
        }
    }
}

/// Navigation arrow with a notch (pilot) or plain triangle (retriever).
struct MarkerShape: SwiftUI.Shape {
    let kind: HeadingMarker.Shape
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.midX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
        if kind == .arrow { p.addLine(to: CGPoint(x: r.midX, y: r.maxY - r.height * 0.28)) }
        p.addLine(to: CGPoint(x: r.minX, y: r.maxY))
        p.closeSubpath()
        return p
    }
}

struct PilotMarker: View {
    let freshness: String
    let simulated: Bool
    let course: Double?

    var body: some View {
        VStack(spacing: 2) {
            HeadingMarker(course: course, tint: AeroTokens.primary, shape: .arrow, dimmed: freshness == "lost")
                .opacity(freshness == "stale" ? 0.6 : 1)
            if simulated { SimBadge() }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(freshness == "live" ? "Canlı pilot" : (freshness == "stale" ? "Gecikmeli pilot" : "Sinyali kayıp pilot")))
    }
}

struct RetrievalPin: View {
    let status: RetrievalStatus
    var body: some View {
        Image(icon: status == .requested ? "hand.raised.fill" : (status == .pickedUp ? "figure.seated.side" : "mappin.circle.fill"))
            .font(.callout.weight(.bold))
            .padding(6)
            .foregroundStyle(.white)
            .background(status.tone.color, in: Circle())
            .overlay(Circle().strokeBorder(.white, lineWidth: 2))
            .accessibilityLabel(Text("Retrieve: \(status.title)"))
    }
}

struct RetrieverPin: View {
    var onDuty = true
    var course: Double? = nil
    var body: some View {
        HeadingMarker(course: course ?? 0, tint: AeroTokens.retrieval, shape: .triangle, dimmed: !onDuty)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(onDuty ? "Retriever (görevde)" : "Retriever"))
    }
}
