import CoreLocation
import MapKit
import RetfastCore
import SwiftUI

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

/// Role badge: member role and/or organizer. Icon + text, never colour alone.
struct RoleBadges: View {
    let event: Event
    var body: some View {
        HStack(spacing: AeroTokens.Space.s1) {
            if let role = event.memberRole {
                StatusPill(role.title, systemImage: role.systemImage, tone: role == .pilot ? .active : (role == .retriever ? .success : .info))
            }
            if event.isOrganizer {
                StatusPill(String(localized: "Organizatör"), systemImage: "star.fill", tone: .info)
            }
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
                StatusPill(String(localized: "konum yok"), systemImage: "mappin.slash", tone: .warning)
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

struct ConnectionPill: View {
    let state: RealtimeConnectionState
    var body: some View {
        switch state {
        case .connected: StatusPill(String(localized: "Canlı bağlı"), systemImage: "bolt.horizontal.circle", tone: .active)
        case .connecting: StatusPill(String(localized: "Bağlanıyor"), systemImage: "arrow.triangle.2.circlepath", tone: .info)
        case .reconnecting(let attempt, _): StatusPill(String(localized: "Yeniden bağlanıyor (\(attempt))"), systemImage: "arrow.triangle.2.circlepath", tone: .warning)
        case .disconnected: StatusPill(String(localized: "Canlı bağlantı yok · yenileniyor"), systemImage: "bolt.horizontal.circle.fill", tone: .warning)
        }
    }
}

enum AppleMaps {
    /// Opens Apple Maps with driving directions to the coordinate.
    static func directionsURL(to c: CLLocationCoordinate2D, name: String) -> URL? {
        var comps = URLComponents(string: "https://maps.apple.com/")
        comps?.queryItems = [
            URLQueryItem(name: "daddr", value: String(format: "%.6f,%.6f", c.latitude, c.longitude)),
            URLQueryItem(name: "dirflg", value: "d"),
            URLQueryItem(name: "q", value: name),
        ]
        return comps?.url
    }

    static func telURL(_ phone: String?) -> URL? {
        guard let phone, !phone.isEmpty else { return nil }
        let digits = phone.filter { $0.isNumber || $0 == "+" }
        return digits.isEmpty ? nil : URL(string: "tel:\(digits)")
    }
}

extension SharedPosition {
    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
}

// MARK: Bottom sheet

enum SheetDetent: CaseIterable { case peek, half, full }

/// Map-first bottom sheet with three detents. Custom (not a system sheet) so
/// it lives inside the navigation stack, keeps the map interactive and
/// coexists with alerts and other sheets. Reduce Motion: no spring.
struct BottomSheet<Header: View, Content: View>: View {
    @Binding var detent: SheetDetent
    @ViewBuilder var header: Header
    @ViewBuilder var content: Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Live drag offset. Plain @State (not @GestureState) so the release can be
    /// animated together with the detent change instead of jumping back first.
    @State private var drag: CGFloat = 0
    /// Content is scrolled to the top: dragging it down collapses the sheet.
    @State private var atTop = true

    private var spring: Animation? { reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.86) }

    var body: some View {
        GeometryReader { geo in
            let full = geo.size.height * 0.92
            let heights: [SheetDetent: CGFloat] = [.peek: min(180, full), .half: geo.size.height * 0.52, .full: full]
            let base = heights[detent] ?? 300
            let height = min(full + 24, max(heights[.peek]! - 24, base - drag))

            VStack(spacing: 0) {
                VStack(spacing: AeroTokens.Space.s2) {
                    Capsule().fill(AeroTokens.textMuted.opacity(0.6)).frame(width: 44, height: 5).padding(.top, 10)
                        .accessibilityHidden(true)
                    header
                }
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
                .onTapGesture {
                    withAnimation(spring) { detent = detent == .peek ? .half : (detent == .half ? .full : .half) }
                }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isButton)
                .accessibilityHint(Text("Paneli büyüt veya küçült"))
                .accessibilityIdentifier("sheet.handle")
                .accessibilityAction(named: Text("Büyüt")) { detent = detent == .peek ? .half : .full }
                .accessibilityAction(named: Text("Küçült")) { detent = detent == .full ? .half : .peek }

                ScrollView {
                    content
                        .padding(.horizontal, AeroTokens.Space.s4)
                        .padding(.bottom, AeroTokens.Space.s6)
                        .onGeometryChange(for: Bool.self) { $0.frame(in: .named("sheetScroll")).minY >= -1 } action: { atTop = $0 }
                }
                .coordinateSpace(name: "sheetScroll")
                // Below full height the whole sheet is a drag surface (like Maps):
                // swiping the content moves the sheet instead of scrolling it.
                .scrollDisabled(detent != .full)
            }
            .frame(height: height, alignment: .top)
            .frame(maxWidth: .infinity)
            .background(AeroTokens.background, in: UnevenRoundedRectangle(topLeadingRadius: AeroTokens.Radius.xl, topTrailingRadius: AeroTokens.Radius.xl, style: .continuous))
            .clipShape(UnevenRoundedRectangle(topLeadingRadius: AeroTokens.Radius.xl, topTrailingRadius: AeroTokens.Radius.xl, style: .continuous))
            .shadow(color: .black.opacity(0.25), radius: 16, y: -2)
            .simultaneousGesture(dragGesture(heights: heights, base: base), including: detent == .full && !atTop ? .subviews : .all)
            // Ink panel under a light map, like the reference designs.
            .environment(\.colorScheme, .dark)
            .frame(maxHeight: .infinity, alignment: .bottom)
            .ignoresSafeArea(edges: .bottom)
        }
    }

    private func dragGesture(heights: [SheetDetent: CGFloat], base: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { v in
                // At full height only a downward pull from the top collapses; upward is scrolling.
                if detent == .full && v.translation.height < 0 { drag = 0; return }
                drag = v.translation.height
            }
            .onEnded { v in
                let predicted = base - v.predictedEndTranslation.height
                let order: [SheetDetent] = [.peek, .half, .full]
                var next = order.min { abs((heights[$0] ?? 0) - predicted) < abs((heights[$1] ?? 0) - predicted) } ?? detent
                // A clear flick always moves at least one step in its direction.
                let i = order.firstIndex(of: detent) ?? 1
                if next == detent, abs(v.predictedEndTranslation.height) > 120 {
                    next = order[min(order.count - 1, max(0, i + (v.predictedEndTranslation.height < 0 ? 1 : -1)))]
                }
                if detent == .full && !atTop && next != .full { next = .full }
                withAnimation(spring) {
                    detent = next
                    drag = 0
                }
            }
    }
}

/// Header block shared by every event sheet.
struct EventSheetHeader: View {
    let event: Event
    var body: some View {
        HStack(alignment: .center, spacing: AeroTokens.Space.s3) {
            VStack(alignment: .leading, spacing: 4) {
                Text(event.name).font(.title2.bold()).foregroundStyle(AeroTokens.textPrimary).lineLimit(2)
                HStack(spacing: 6) {
                    if let role = event.memberRole {
                        Label(role.title, systemImage: role.systemImage)
                    }
                    if event.isOrganizer { Label("Organizatör", systemImage: "star.fill") }
                    if let loc = event.locationName, !loc.isEmpty { Text("· \(loc)").lineLimit(1) }
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(AeroTokens.textSecondary)
            }
            Spacer()
            EventStatusPill(status: event.status)
        }
        .padding(.horizontal, AeroTokens.Space.s4)
        .padding(.bottom, AeroTokens.Space.s3)
    }
}

/// Event details card (description, dates, launch sites).
struct EventInfoCard: View {
    let event: Event
    let sites: [LaunchSite]

    var body: some View {
        AeroCard {
            SectionHeader(title: String(localized: "Etkinlik"))
            if let d = event.description, !d.isEmpty {
                Text(d).font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
            }
            if let loc = event.locationName, !loc.isEmpty {
                KeyValueRow(key: String(localized: "Yer"), value: loc)
            }
            KeyValueRow(key: String(localized: "Tarih"), value: EventDates.range(event))
            if let o = event.organizers, !o.isEmpty {
                KeyValueRow(key: String(localized: "Organizatör"), value: o.map(\.displayName).joined(separator: ", "))
            }
            if let c = event.counts {
                KeyValueRow(key: String(localized: "Pilot / gözlemci / retriever"),
                            value: "\(c.pilots ?? 0) / \(c.observers ?? 0) / \(c.retrievers ?? 0)")
            }
            if event.center != nil, event.centerIsApproximate ?? false {
                WarningRow(text: String(localized: "Etkinlik merkezi yaklaşıktır; kalkış alanı olarak kullanmayın."), systemImage: "scope")
            }
        }
        if !sites.isEmpty {
            AeroCard {
                SectionHeader(title: String(localized: "Kalkış alanları"))
                ForEach(sites) { s in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.name).font(.subheadline.weight(.semibold))
                        LaunchSiteBadges(site: s)
                        if let n = s.notes, !n.isEmpty { Text(n).font(.caption).foregroundStyle(AeroTokens.textSecondary) }
                    }
                }
            }
        }
    }
}
