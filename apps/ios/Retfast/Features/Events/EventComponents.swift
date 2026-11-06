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

/// Height of the map area the sheet covers at its resting detent (not during a
/// drag), so maps can keep their centre and the user's dot above it.
struct SheetCoverKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// Map-first bottom sheet with three detents. Custom (not a system sheet) so
/// it lives inside the navigation stack, keeps the map interactive and
/// coexists with alerts and other sheets. The sheet keeps a fixed size and is
/// moved with an offset, so dragging never re-lays out its content.
struct BottomSheet<Header: View, Content: View>: View {
    @Binding var detent: SheetDetent
    var peekHeight: CGFloat = 196
    @ViewBuilder var header: Header
    @ViewBuilder var content: Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drag: CGFloat = 0
    /// Content is scrolled to the top: dragging it down collapses the sheet.
    @State private var atTop = true

    private var spring: Animation? { reduceMotion ? nil : .interactiveSpring(response: 0.38, dampingFraction: 0.86, blendDuration: 0.1) }

    var body: some View {
        GeometryReader { geo in
            let bottomInset = geo.safeAreaInsets.bottom
            let total = geo.size.height + bottomInset
            let full = total - 8
            let heights: [SheetDetent: CGFloat] = [.peek: min(peekHeight + bottomInset, full), .half: total * 0.5, .full: full]
            let base = heights[detent] ?? 300
            let visible = rubberBand(base - drag, min: heights[.peek]!, max: full)

            chrome(bottomInset: bottomInset)
                .frame(width: geo.size.width, height: full, alignment: .top)
                .background(AeroTokens.background, in: UnevenRoundedRectangle(topLeadingRadius: AeroTokens.Radius.xl, topTrailingRadius: AeroTokens.Radius.xl, style: .continuous))
                .clipShape(UnevenRoundedRectangle(topLeadingRadius: AeroTokens.Radius.xl, topTrailingRadius: AeroTokens.Radius.xl, style: .continuous))
                .shadow(color: .black.opacity(0.18), radius: 18, y: -2)
                .simultaneousGesture(dragGesture(heights: heights, base: base), including: detent == .full && !atTop ? .subviews : .all)
                .offset(y: total - visible)
                .frame(maxHeight: .infinity, alignment: .top)
                .ignoresSafeArea(edges: .bottom)
                .preference(key: SheetCoverKey.self, value: min(base, total * 0.5))
        }
    }

    private func chrome(bottomInset: CGFloat) -> some View {
        VStack(spacing: 0) {
            VStack(spacing: AeroTokens.Space.s2) {
                Capsule().fill(AeroTokens.textMuted.opacity(0.45)).frame(width: 40, height: 5).padding(.top, 8)
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
                    .padding(.top, AeroTokens.Space.s1)
                    .padding(.bottom, bottomInset + AeroTokens.Space.s8)
                    .onGeometryChange(for: Bool.self) { $0.frame(in: .named("sheetScroll")).minY >= -1 } action: { atTop = $0 }
            }
            .coordinateSpace(name: "sheetScroll")
            .scrollIndicators(.hidden)
            // Below full height the whole sheet is a drag surface (like Maps).
            .scrollDisabled(detent != .full)
        }
    }

    /// Soft resistance past the first/last detent instead of a hard stop.
    private func rubberBand(_ v: CGFloat, min lo: CGFloat, max hi: CGFloat) -> CGFloat {
        if v < lo { return lo - (lo - v) * 0.25 }
        if v > hi { return hi + (v - hi) * 0.15 }
        return v
    }

    private func dragGesture(heights: [SheetDetent: CGFloat], base: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 6, coordinateSpace: .global)
            .onChanged { v in
                // At full height only a downward pull from the top collapses; upward is scrolling.
                if detent == .full && v.translation.height < 0 { if drag != 0 { drag = 0 }; return }
                if detent == .full && !atTop { return }
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
                Text(event.name).font(.title3.weight(.bold)).foregroundStyle(AeroTokens.textPrimary).lineLimit(1)
                HStack(spacing: 6) {
                    if let role = event.memberRole {
                        Label(role.title, icon: role.systemImage).foregroundStyle(AeroTokens.primary)
                    }
                    if let loc = event.locationName, !loc.isEmpty {
                        Text(loc).lineLimit(1)
                    }
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(AeroTokens.textSecondary)
            }
            Spacer(minLength: 0)
            EventStatusPill(status: event.status)
        }
        .padding(.horizontal, AeroTokens.Space.s4)
        .padding(.bottom, AeroTokens.Space.s3)
    }
}

/// Event details: wide info tiles plus the description. Organizers are not shown.
struct EventInfoCard: View {
    let event: Event
    var live: EventLiveModel?

    var body: some View {
        VStack(alignment: .leading, spacing: AeroTokens.Space.s3) {
            Text("Etkinlik").font(.headline).foregroundStyle(AeroTokens.textPrimary)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: AeroTokens.Space.s2), GridItem(.flexible())], spacing: AeroTokens.Space.s2) {
                InfoTile(icon: "calendar", title: String(localized: "Tarih"), value: EventDates.range(event))
                if let live {
                    InfoTile(icon: "paperplane.fill", title: String(localized: "Havada"), value: String(localized: "\(live.pilots.count) pilot"))
                }
                if let loc = event.locationName, !loc.isEmpty {
                    InfoTile(icon: "mappin.and.ellipse", title: String(localized: "Konum"), value: loc)
                }
                if let live {
                    InfoTile(icon: "car.fill", title: String(localized: "Retriever"), value: String(localized: "\(live.retrievers.count) araç"))
                }
            }
            if let d = event.description, !d.isEmpty {
                Text(d).font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("event.info")
    }
}

/// Wide two-line info box: icon, small caption, value.
struct InfoTile: View {
    let icon: String
    let title: String
    let value: String

    var body: some View {
        HStack(spacing: AeroTokens.Space.s3) {
            Image(icon: icon)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(AeroTokens.primary)
                .frame(width: 36, height: 36)
                .background(AeroTokens.primarySoft, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.caption).foregroundStyle(AeroTokens.textMuted)
                Text(value).font(.subheadline.weight(.semibold)).foregroundStyle(AeroTokens.textPrimary)
                    .lineLimit(2).minimumScaleFactor(0.8)
            }
            Spacer(minLength: 0)
        }
        .padding(AeroTokens.Space.s3)
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        .background(AeroTokens.surface, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.md, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: Weather

/// Open-Meteo forecast for the event centre with a coarse flyability advisory.
/// Hidden when the event has no centre or the forecast is unavailable.
struct WeatherCard: View {
    @Environment(AppModel.self) private var model
    let event: Event
    @State private var weather: Weather?

    var body: some View {
        Group {
            if let w = weather { content(w) } else { Color.clear.frame(height: 0) }
        }
        .task(id: event.id) {
            guard event.center != nil else { return }
            weather = try? await model.api.weather(eventId: event.id)
        }
    }

    @ViewBuilder private func content(_ w: Weather) -> some View {
        let now = w.hourly.first
        let tone = Self.tone(w.flyability)
        let wind = w.current.windMs ?? now?.windMs
        let dirDeg = w.current.windDirDeg ?? now?.windDirDeg
        let hours = Array(w.hourly.prefix(12))
        VStack(alignment: .leading, spacing: AeroTokens.Space.s3) {
            HStack(alignment: .center, spacing: AeroTokens.Space.s3) {
                ZStack {
                    Circle().fill(tone.color.opacity(0.14))
                    Image(icon: "arrow.up")
                        .font(.system(size: 18, weight: .bold))
                        .rotationEffect(.degrees((dirDeg ?? 0) + 180))
                        .opacity(dirDeg == nil ? 0.3 : 1)
                        .foregroundStyle(tone.color)
                }
                .frame(width: 46, height: 46)
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Hava durumu").font(.caption).foregroundStyle(AeroTokens.textMuted)
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(Self.speedValue(wind)).font(.title3.weight(.semibold).monospacedDigit())
                            .foregroundStyle(AeroTokens.textPrimary)
                        Text(Fmt.speed(wind).1 + Self.dir(dirDeg)).font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
                    }
                    Text(details(w, now)).font(.footnote).foregroundStyle(AeroTokens.textSecondary)
                        .lineLimit(1).minimumScaleFactor(0.8)
                }
                Spacer(minLength: 0)
                verdict(w.flyability, tone: tone)
            }
            if let reasons = w.flyReasons, !reasons.isEmpty {
                Label(reasons.map(Self.reason).joined(separator: " · "), icon: "exclamationmark.triangle")
                    .font(.footnote.weight(.medium)).foregroundStyle(tone.color)
            }
            if !hours.isEmpty {
                let scale = max(8, hours.compactMap(\.windMs).max() ?? 0)
                HStack(alignment: .bottom, spacing: 4) {
                    ForEach(hours) { h in hourBar(h, scale: scale) }
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("weather.hours")
            }
            Link(destination: URL(string: "https://open-meteo.com/")!) {
                (Text("Bilgi amaçlıdır; karar pilotun.") + Text(" · ") + Text(w.attribution))
                    .font(.caption2).foregroundStyle(AeroTokens.textMuted)
                    .multilineTextAlignment(.leading)
            }
        }
        .padding(AeroTokens.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AeroTokens.surface, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
        .accessibilityIdentifier("event.weather")
    }

    private func details(_ w: Weather, _ now: WeatherHour?) -> String {
        var parts = [String(localized: "Hamle \(Self.speed(w.current.gustMs ?? now?.gustMs))")]
        if let base = now?.cloudBaseM { parts.append(String(localized: "Taban \(Self.alt(base))")) }
        if let t = w.current.tempC ?? now?.tempC { parts.append(String(format: "%.0f °C", t)) }
        return parts.joined(separator: " · ")
    }

    private func verdict(_ f: String, tone: Tone) -> some View {
        HStack(spacing: 5) {
            Circle().fill(tone.color).frame(width: 7, height: 7)
            Text(Self.verdictText(f)).font(.caption.weight(.semibold))
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(tone.color.opacity(0.14), in: Capsule())
    }

    private func hourBar(_ h: WeatherHour, scale: Double) -> some View {
        let tone = Self.tone(h.flyability)
        return VStack(spacing: 3) {
            Text(Self.speedValue(h.windMs)).font(.system(size: 10, weight: .semibold).monospacedDigit())
                .foregroundStyle(AeroTokens.textSecondary)
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(tone == .neutral ? AeroTokens.surfaceElevated : tone.color.opacity(0.8))
                .frame(height: max(4, 30 * min(h.windMs ?? 0, scale) / scale))
            Text(h.t, format: .dateTime.hour(.twoDigits(amPM: .omitted)))
                .font(.system(size: 10).monospacedDigit()).foregroundStyle(AeroTokens.textMuted)
        }
        .frame(maxWidth: .infinity)
    }

    static func verdictText(_ f: String) -> String {
        switch f {
        case "good": String(localized: "Uygun")
        case "marginal": String(localized: "Sınırda")
        case "poor": String(localized: "Önerilmez")
        default: String(localized: "Bilinmiyor")
        }
    }

    static func tone(_ f: String) -> Tone {
        switch f {
        case "good": .success
        case "marginal": .warning
        case "poor": .error
        default: .neutral
        }
    }

    static func pill(_ f: String) -> StatusPill {
        switch f {
        case "good": StatusPill(String(localized: "Uçulabilir görünüyor"), systemImage: "checkmark.circle", tone: .success)
        case "marginal": StatusPill(String(localized: "Sınırda"), systemImage: "exclamationmark.triangle", tone: .warning)
        case "poor": StatusPill(String(localized: "Önerilmez"), systemImage: "exclamationmark.triangle", tone: .error)
        default: StatusPill(String(localized: "Bilinmiyor"), systemImage: "questionmark.circle", tone: .neutral)
        }
    }

    static func reason(_ r: String) -> String {
        switch r {
        case "strong_wind": String(localized: "Kuvvetli rüzgar")
        case "gusty": String(localized: "Hamleli rüzgar")
        case "wind_aloft": String(localized: "Yüksekte kuvvetli rüzgar")
        case "rain": String(localized: "Yağış olasılığı")
        case "overdevelopment": String(localized: "Aşırı gelişme (CB) riski")
        default: r
        }
    }

    static func speed(_ ms: Double?) -> String { let s = Fmt.speed(ms); return "\(s.0) \(s.1)" }
    static func speedValue(_ ms: Double?) -> String { Fmt.speed(ms).0 }
    static func alt(_ m: Double?) -> String { let a = Fmt.altitude(m); return "\(a.0) \(a.1)" }
    static func dir(_ deg: Double?) -> String {
        guard let deg else { return "" }
        let names = Locale.current.language.languageCode == .turkish
            ? ["K", "KD", "D", "GD", "G", "GB", "B", "KB"] : ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
        return " · " + names[Int(((deg.truncatingRemainder(dividingBy: 360) + 360 + 22.5) / 45)) % 8]
    }
}
