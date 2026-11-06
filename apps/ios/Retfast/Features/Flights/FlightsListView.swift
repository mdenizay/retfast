import Charts
import MapKit
import RetfastCore
import SwiftUI

struct FlightSyncPill: View {
    let flight: LocalFlight
    @Environment(AppModel.self) private var model
    @State private var counts = LocalTelemetryStore.SyncCounts()

    var body: some View {
        Group {
            if flight.state.isActive {
                StatusPill(String(localized: "Kayıt sürüyor"), systemImage: "record.circle", tone: .active)
            } else if let error = flight.lastError, !flight.serverCreated || flight.serverEnded {
                StatusPill(String(localized: "Sunucu kabul etmedi (\(error))"), systemImage: "exclamationmark.icloud", tone: .error)
            } else if counts.pending > 0 {
                StatusPill(String(localized: "Gönderilecek \(counts.pending) nokta"), systemImage: "icloud.and.arrow.up", tone: .warning)
            } else if !flight.serverCreated {
                StatusPill(String(localized: "Sunucuya gönderilecek"), systemImage: "icloud.and.arrow.up", tone: .warning)
            } else if !flight.serverEnded && flight.state == .completed {
                StatusPill(String(localized: "Sunucuda kapatılıyor"), systemImage: "icloud.and.arrow.up", tone: .warning)
            } else {
                StatusPill(String(localized: "Senkronize") + (counts.rejected > 0 ? String(localized: " · \(counts.rejected) reddedildi") : ""),
                           systemImage: "checkmark.icloud", tone: .success)
            }
        }
        .task(id: model.syncSnapshot) { counts = (try? model.store.syncCounts(flightId: flight.id)) ?? counts }
    }
}

private extension LocalFlight {
    var duration: TimeInterval { (endedAt ?? lastSampleAt ?? startedAt).timeIntervalSince(startedAt) }
}

/// One entry of the flights list: a flight on this device or one known only to the server.
private enum FlightEntry: Identifiable {
    case local(LocalFlight)
    case remote(Flight)

    var id: String {
        switch self {
        case .local(let f): f.id.uuidString.lowercased()
        case .remote(let f): f.id.lowercased()
        }
    }
    var date: Date {
        switch self {
        case .local(let f): f.startedAt
        case .remote(let f): f.startedAt ?? .distantPast
        }
    }
    var duration: TimeInterval {
        switch self {
        case .local(let f): f.duration
        case .remote(let f): f.stats?.durationS ?? 0
        }
    }
}

struct FlightRow: View {
    let flight: LocalFlight
    var body: some View {
        FlightCardContent(date: flight.startedAt, title: flight.eventName ?? String(localized: "Kişisel uçuş"),
                          duration: flight.duration, distance: nil, isSimulated: flight.isSimulated,
                          isLive: flight.state.isActive) {
            FlightSyncPill(flight: flight)
        }
    }
}

private struct FlightCardContent<Footer: View>: View {
    let date: Date?
    let title: String
    let duration: TimeInterval
    let distance: Double?
    let isSimulated: Bool
    var isLive = false
    @ViewBuilder var footer: Footer

    var body: some View {
        HStack(alignment: .top, spacing: AeroTokens.Space.s3) {
            VStack(spacing: 1) {
                Text(date.map { $0.formatted(.dateTime.day()) } ?? Fmt.dash)
                    .font(.system(size: 20, weight: .semibold)).monospacedDigit()
                Text(date.map { $0.formatted(.dateTime.weekday(.abbreviated)) } ?? "")
                    .font(.system(size: 10, weight: .semibold)).textCase(.uppercase)
                    .foregroundStyle(isLive ? AeroTokens.onPrimary : AeroTokens.textMuted)
            }
            .foregroundStyle(isLive ? AeroTokens.onPrimary : AeroTokens.textPrimary)
            .frame(width: 52, height: 52)
            .background(isLive ? AeroTokens.primary : AeroTokens.surfaceElevated,
                        in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text(title).font(.headline).lineLimit(1)
                    if isSimulated { SimBadge() }
                }
                HStack(spacing: AeroTokens.Space.s2) {
                    Label(date?.formatted(date: .omitted, time: .shortened) ?? Fmt.dash, icon: "clock")
                    Label(Fmt.duration(duration), icon: "timer")
                    if let distance { Label(Fmt.distanceText(distance), icon: "point.topleft.down.to.point.bottomright.curvepath") }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .labelStyle(CompactLabelStyle())
                .font(.footnote.monospacedDigit())
                .foregroundStyle(AeroTokens.textSecondary)
                footer
            }
            Spacer(minLength: 0)
            Image(icon: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundStyle(AeroTokens.textMuted)
                .frame(width: 30, height: 30)
                .background(AeroTokens.surfaceElevated, in: Circle())
        }
        .padding(16)
        .background(AeroTokens.surface, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
    }
}

struct CompactLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 3) { configuration.icon.font(.caption2); configuration.title }
    }
}

struct FlightsListView: View {
    @Environment(AppModel.self) private var model
    @State private var local: [LocalFlight] = []
    @State private var remote: [Flight] = []
    @State private var remoteError: String?
    @State private var loaded = false

    /// Server flights not on this device (other phone, reinstall, pruned).
    private var remoteOnly: [Flight] {
        let ids = Set(local.map { $0.id.uuidString.lowercased() })
        return remote.filter { !ids.contains($0.id.lowercased()) }
    }

    private var entries: [FlightEntry] {
        (local.map(FlightEntry.local) + remoteOnly.map(FlightEntry.remote)).sorted { $0.date > $1.date }
    }

    private var months: [(key: Date, items: [FlightEntry])] {
        let cal = Calendar.current
        let groups = Dictionary(grouping: entries) { cal.date(from: cal.dateComponents([.year, .month], from: $0.date)) ?? $0.date }
        return groups.map { (key: $0.key, items: $0.value) }.sorted { $0.key > $1.key }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: AeroTokens.Space.s3) {
                if entries.isEmpty {
                    if loaded {
                        ContentUnavailableView("Henüz uçuş yok", systemImage: "point.topleft.down.to.point.bottomright.curvepath",
                                               description: Text("Bir etkinliğin ekranından uçuş başlattığında burada görünür."))
                            .padding(.top, 80)
                    }
                } else {
                    summary
                }
                if let remoteError { WarningRow(text: remoteError, tone: .warning).padding(.horizontal, 4) }
                ForEach(months, id: \.key) { month in
                    SectionTitle(month.key.formatted(.dateTime.month(.wide).year()), count: month.items.count)
                        .padding(.top, AeroTokens.Space.s4)
                        .padding(.horizontal, 4)
                    ForEach(month.items) { entry in row(entry) }
                }
            }
            .padding(.horizontal, AeroTokens.Space.s4)
            .padding(.bottom, AeroTokens.Space.s8)
        }
        .aeroBackground()
        .navigationTitle("Uçuşlarım")
        .task { await load() }
        .refreshable { await load() }
        .onChange(of: model.session.state) { _, _ in local = (try? model.store.recentFlights(limit: 200)) ?? local }
    }

    @ViewBuilder
    private func row(_ entry: FlightEntry) -> some View {
        switch entry {
        case .local(let f):
            NavigationLink { FlightDetailView(flightId: f.id) } label: { FlightRow(flight: f) }
                .buttonStyle(.plain)
                .accessibilityIdentifier("flights.row.\(f.id.uuidString.prefix(8))")
        case .remote(let f):
            NavigationLink { RemoteFlightDetailView(flight: f) } label: {
                FlightCardContent(date: f.startedAt, title: f.eventId == nil ? String(localized: "Kişisel uçuş") : String(localized: "Etkinlik uçuşu"),
                                  duration: f.stats?.durationS ?? 0, distance: f.stats?.distanceM, isSimulated: f.isSimulated == true) {
                    StatusPill(String(localized: "Sunucuda"), systemImage: "checkmark.icloud", tone: .info)
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("flights.row.remote.\(f.id.prefix(8))")
        }
    }

    private var summary: some View {
        let all = entries
        let airtime = all.reduce(0) { $0 + $1.duration }
        let cal = Calendar.current
        let thisYear = all.filter { cal.isDate($0.date, equalTo: .now, toGranularity: .year) }
        let longest = all.map(\.duration).max() ?? 0
        return VStack(spacing: 14) {
            AeroCard {
                Text("Özet").font(.headline).foregroundStyle(AeroTokens.textPrimary)
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    StatTile(value: hours(airtime), label: String(localized: "Toplam havada"), systemImage: "timer")
                    StatTile(value: "\(all.count)", label: String(localized: "Toplam uçuş"), systemImage: "paperplane")
                    StatTile(value: "\(thisYear.count)", label: String(localized: "Bu yıl"), systemImage: "calendar")
                    StatTile(value: hours(longest), label: String(localized: "En uzun"), systemImage: "trophy")
                }
            }
            AeroCard {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Uçuş aktivitesi").font(.headline).foregroundStyle(AeroTokens.textPrimary)
                    Text("Son 16 hafta").font(.footnote).foregroundStyle(AeroTokens.textSecondary)
                }
                ActivityHeatmap(levels: heatLevels(all), columns: 16, spacing: 4)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("flights.summary")
    }

    /// 112 days, oldest first; level from airtime that day.
    private func heatLevels(_ all: [FlightEntry]) -> [Int] {
        let cal = Calendar.current
        let today = cal.startOfDay(for: .now)
        var perDay = [Int: TimeInterval]()
        for e in all {
            let d = cal.dateComponents([.day], from: cal.startOfDay(for: e.date), to: today).day ?? 999
            if d >= 0 && d < 112 { perDay[111 - d, default: 0] += e.duration }
        }
        return (0..<112).map { i in
            guard let s = perDay[i], s > 0 else { return 0 }
            return s < 1800 ? 1 : s < 3600 ? 2 : s < 7200 ? 3 : 4
        }
    }

    private func hours(_ s: TimeInterval) -> String {
        let m = Int(s / 60)
        return m < 60 ? String(localized: "\(m) dk") : String(localized: "\(m / 60) sa \(m % 60) dk")
    }

    private func load() async {
        local = (try? model.store.recentFlights(limit: 200)) ?? []
        do {
            remote = try await model.api.flights().items
            remoteError = nil
        } catch {
            remoteError = String(localized: "Sunucudaki uçuşlar alınamadı: ") + ErrorText.message(error)
        }
        loaded = true
    }
}

// MARK: Detail

/// Map, replay entry point, stats grid and charts for any track.
struct FlightTrackSummary: View {
    let track: FlightTrack
    let title: String
    @State private var replaying = false

    var body: some View {
        VStack(alignment: .leading, spacing: AeroTokens.Space.s4) {
            if !track.isEmpty {
                ZStack(alignment: .bottomTrailing) {
                    FlightRouteMap(points: track.thinned(800))
                        .frame(height: 280)
                        .clipShape(RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
                        .allowsHitTesting(false)
                    Button { replaying = true } label: {
                        Label("Tekrar oynat", icon: "play.fill")
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(AeroTokens.onPrimary)
                            .padding(.horizontal, 18).frame(height: 46)
                            .background(AeroTokens.primary, in: Capsule())
                            .shadow(color: .black.opacity(0.25), radius: 8, y: 3)
                    }
                    .padding(AeroTokens.Space.s3)
                    .accessibilityIdentifier("flight.replay")
                }
                .onTapGesture { replaying = true }
            }
            statsGrid
            if track.points.count > 2 { charts }
        }
        .fullScreenCover(isPresented: $replaying) { FlightReplayView(track: track, title: title) }
    }

    private func v(_ p: (String, String)) -> (String, String?) { (p.0, p.0 == Fmt.dash ? nil : p.1) }

    private var statsGrid: some View {
        let s = track.stats
        let gain = (s.maxAlt ?? 0) - (s.takeoffAlt ?? 0)
        typealias Row = (String, (String, String?))
        let groups: [(String, [Row])] = [
            (String(localized: "Mesafe"), [
                (String(localized: "Düz mesafe"), v(Fmt.distance(s.straightDistance))),
                (String(localized: "Kalkıştan en uzak"), v(Fmt.distance(s.maxFromTakeoff))),
                (String(localized: "Maks yer hızı"), v(Fmt.speed(s.maxSpeed))),
                (String(localized: "Ort. yer hızı"), v(Fmt.speed(s.avgSpeed))),
            ]),
            (String(localized: "İrtifa"), [
                (String(localized: "Kalkış üstü kazanç"), v(Fmt.altitude(s.maxAlt == nil ? nil : max(0, gain)))),
                (String(localized: "Kalkış irtifası"), v(Fmt.altitude(s.takeoffAlt))),
                (String(localized: "İniş irtifası"), v(Fmt.altitude(s.landingAlt))),
                (String(localized: "Toplam tırmanış"), v(Fmt.altitude(s.ascent))),
                (String(localized: "Toplam alçalma"), v(Fmt.altitude(s.descent))),
            ]),
            (String(localized: "Termik"), [
                (String(localized: "Maks tırmanış"), v(Fmt.vario(s.maxClimb))),
                (String(localized: "Maks çöküş"), v(Fmt.vario(s.maxSink))),
                (String(localized: "En iyi termik"), v(Fmt.vario(s.bestClimbAvg))),
                (String(localized: "Termik sayısı"), (s.climbCount > 0 ? "\(s.climbCount)" : Fmt.dash, nil)),
                (String(localized: "Tırmanışta"), (s.climbingShare > 0 ? "\(Int((s.climbingShare * 100).rounded()))" : Fmt.dash, "%")),
            ]),
        ]
        let visible = groups.map { ($0.0, $0.1.filter { $0.1.0 != Fmt.dash }) }.filter { !$0.1.isEmpty }
        return VStack(alignment: .leading, spacing: AeroTokens.Space.s3) {
            HStack(spacing: 0) {
                heroMetric(String(localized: "Süre"), (Fmt.duration(s.duration), nil))
                heroDivider
                heroMetric(String(localized: "Mesafe"), v(Fmt.distance(s.distance)))
                heroDivider
                heroMetric(String(localized: "Maks irtifa"), v(Fmt.altitude(s.maxAlt)))
            }
            .padding(.vertical, AeroTokens.Space.s4)
            .background(AeroTokens.surface, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
            .accessibilityElement(children: .combine)

            ForEach(visible.indices, id: \.self) { gi in
                VStack(alignment: .leading, spacing: 6) {
                    Text(visible[gi].0).font(.footnote.weight(.semibold)).foregroundStyle(AeroTokens.textSecondary)
                        .padding(.leading, 4)
                    VStack(spacing: 0) {
                        ForEach(visible[gi].1.indices, id: \.self) { i in
                            let r = visible[gi].1[i]
                            if i > 0 { Divider().overlay(AeroTokens.border).padding(.leading, AeroTokens.Space.s4) }
                            HStack {
                                Text(r.0).font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
                                Spacer(minLength: 8)
                                (Text(r.1.0).font(.subheadline.weight(.semibold)).foregroundStyle(AeroTokens.textPrimary)
                                 + Text(r.1.1.map { " " + $0 } ?? "").font(.footnote).foregroundStyle(AeroTokens.textMuted))
                                    .monospacedDigit()
                            }
                            .padding(.horizontal, AeroTokens.Space.s4).frame(minHeight: 44)
                            .accessibilityElement(children: .combine)
                        }
                    }
                    .background(AeroTokens.surface, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
                }
            }
            Text("İrtifa ve vario GPS'ten hesaplanır (barometrik değildir); termik sayısı yaklaşık bir tahmindir.")
                .font(.caption).foregroundStyle(AeroTokens.textMuted).padding(.horizontal, 4)
        }
    }

    private var heroDivider: some View {
        Rectangle().fill(AeroTokens.border).frame(width: 1, height: 40)
    }

    private func heroMetric(_ label: String, _ value: (String, String?)) -> some View {
        VStack(spacing: 4) {
            (Text(value.0).font(.system(size: 22, weight: .semibold))
             + Text(value.1.map { " " + $0 } ?? "").font(.footnote.weight(.medium)).foregroundStyle(AeroTokens.textMuted))
                .foregroundStyle(AeroTokens.textPrimary).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.6)
            Text(label).font(.caption).foregroundStyle(AeroTokens.textMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 6)
    }

    private var charts: some View {
        let pts = track.thinned(400)
        let altF = Units.current == .metric ? 1.0 : 3.28084
        let spdF = Units.current == .metric ? 3.6 : 2.23694
        let varF = Units.current == .metric ? 1.0 : 196.85
        return VStack(alignment: .leading, spacing: AeroTokens.Space.s3) {
            chartCard(String(localized: "İrtifa"), unit: Units.current == .metric ? "m" : "ft") {
                Chart(pts.filter { $0.alt != nil }, id: \.t) {
                    AreaMark(x: .value("t", $0.t / 60), y: .value("alt", $0.alt! * altF))
                        .foregroundStyle(LinearGradient(colors: [Brand.accent.opacity(0.35), Brand.accent.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                    LineMark(x: .value("t", $0.t / 60), y: .value("alt", $0.alt! * altF)).foregroundStyle(Brand.accent)
                }
                .chartYScale(domain: .automatic(includesZero: false))
            }
            chartCard(String(localized: "Vario"), unit: Units.current == .metric ? "m/s" : "ft/min") {
                Chart(pts.filter { $0.vario != nil }, id: \.t) {
                    BarMark(x: .value("t", $0.t / 60), y: .value("vario", $0.vario! * varF), width: 2)
                        .foregroundStyle($0.vario! >= 0 ? AeroTokens.success : AeroTokens.error.opacity(0.7))
                }
            }
            chartCard(String(localized: "Yer hızı"), unit: Units.current == .metric ? "km/h" : "mph") {
                Chart(pts.filter { $0.speed != nil }, id: \.t) {
                    LineMark(x: .value("t", $0.t / 60), y: .value("speed", $0.speed! * spdF)).foregroundStyle(AeroTokens.secondary)
                }
            }
        }
    }

    private func chartCard<C: View>(_ title: String, unit: String, @ViewBuilder chart: () -> C) -> some View {
        AeroCard {
            HStack {
                Text(title).font(.headline)
                Spacer()
                Text(unit + String(localized: " · dakika")).font(.caption).foregroundStyle(AeroTokens.textMuted)
            }
            chart().frame(height: 140)
        }
    }
}

struct FlightDetailView: View {
    let flightId: UUID
    @Environment(AppModel.self) private var model
    @State private var flight: LocalFlight?
    @State private var samples: [TelemetrySample] = []
    @State private var track = FlightTrack(raw: [])
    @State private var counts = LocalTelemetryStore.SyncCounts()
    @State private var gpxURL: URL?
    @State private var showDetails = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AeroTokens.Space.s4) {
                if let f = flight {
                    header(f)
                    FlightTrackSummary(track: track, title: f.eventName ?? String(localized: "Kişisel uçuş"))
                    details(f)
                    if let gpxURL {
                        VStack(alignment: .leading, spacing: AeroTokens.Space.s2) {
                            ShareLink(item: gpxURL) { Label("GPX dışa aktar", icon: "square.and.arrow.up") }
                                .buttonStyle(.aeroSecondary)
                            Text("GPX dosyası telefondaki ham GPS noktalarından oluşturulur. Sertifikalı bir uçuş kaydı değildir (not a certified flight log); yarışma/rekor kanıtı olarak kullanılamaz.")
                                .font(.caption).foregroundStyle(AeroTokens.textMuted)
                        }
                    }
                }
            }
            .padding(AeroTokens.Space.s4)
        }
        .aeroBackground()
        .navigationTitle("Uçuş")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let gpxURL {
                ToolbarItem(placement: .topBarTrailing) {
                    ShareLink(item: gpxURL) { Image(icon: "square.and.arrow.up") }
                        .accessibilityLabel(Text("GPX dışa aktar"))
                }
            }
        }
        .task { load() }
    }

    private func header(_ f: LocalFlight) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(f.eventName ?? String(localized: "Kişisel uçuş")).font(.system(size: 26, weight: .semibold))
                if f.isSimulated { SimBadge() }
            }
            Text(f.startedAt.formatted(date: .complete, time: .shortened))
                .font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
            FlightSyncPill(flight: f).padding(.top, 2)
        }
    }

    /// GPS quality and sync counters folded into one collapsible card; most pilots never need them.
    private func details(_ f: LocalFlight) -> some View {
        let lowQ = samples.filter(\.lowQuality).count
        let avg = samples.isEmpty ? nil : samples.map(\.hAcc).reduce(0, +) / Double(samples.count)
        return VStack(spacing: 0) {
            Button {
                withAnimation(.snappy(duration: 0.25)) { showDetails.toggle() }
            } label: {
                HStack(spacing: 12) {
                    Image(icon: "info.circle")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(AeroTokens.textSecondary)
                        .frame(width: 34, height: 34)
                        .background(AeroTokens.surfaceElevated, in: Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Kayıt ayrıntıları").font(.subheadline.weight(.semibold)).foregroundStyle(AeroTokens.textPrimary)
                        Text("\(samples.count) nokta · \(Fmt.accuracy(avg)) · \(counts.synced)/\(counts.synced + counts.pending + counts.rejected) gönderildi")
                            .font(.footnote).foregroundStyle(AeroTokens.textSecondary).monospacedDigit().lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Image(icon: "chevron.down")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(AeroTokens.textMuted)
                        .rotationEffect(.degrees(showDetails ? 180 : 0))
                }
                .padding(AeroTokens.Space.s4)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("flight.details")
            if showDetails {
                VStack(alignment: .leading, spacing: 0) {
                    Text("GPS kalitesi").font(.footnote.weight(.semibold)).foregroundStyle(AeroTokens.textMuted).padding(.bottom, 4)
                    KeyValueRow(key: String(localized: "Ortalama doğruluk"), value: Fmt.accuracy(avg))
                    KeyValueRow(key: String(localized: "Düşük kaliteli (>50 m)"), value: "\(lowQ)")
                    KeyValueRow(key: String(localized: "En uzun boşluk"), value: Fmt.age(longestGap))
                    if f.interruptionCount > 0 { KeyValueRow(key: String(localized: "Kesinti"), value: "\(f.interruptionCount)") }
                    KeyValueRow(key: String(localized: "Başlangıç"), value: Fmt.coordinate(samples.first?.lat, samples.first?.lon), mono: true)
                    KeyValueRow(key: String(localized: "Bitiş"), value: Fmt.coordinate(samples.last?.lat, samples.last?.lon), mono: true)
                    Text("Senkronizasyon").font(.footnote.weight(.semibold)).foregroundStyle(AeroTokens.textMuted)
                        .padding(.top, AeroTokens.Space.s3).padding(.bottom, 4)
                    KeyValueRow(key: String(localized: "Sunucuya ulaşan"), value: "\(counts.synced)")
                    KeyValueRow(key: String(localized: "Bekleyen"), value: "\(counts.pending)")
                    KeyValueRow(key: String(localized: "Reddedilen"), value: "\(counts.rejected)")
                }
                .padding([.horizontal, .bottom], AeroTokens.Space.s4)
                .transition(.opacity)
            }
        }
        .background(AeroTokens.surface, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
    }

    private var longestGap: TimeInterval {
        zip(samples, samples.dropFirst()).map { $1.t.timeIntervalSince($0.t) }.max() ?? 0
    }

    private func load() {
        flight = try? model.store.flight(id: flightId)
        samples = (try? model.store.samples(flightId: flightId)) ?? []
        track = FlightTrack(samples: samples)
        counts = (try? model.store.syncCounts(flightId: flightId)) ?? counts
        if let f = flight, !samples.isEmpty {
            let name = "Retfast \(f.startedAt.formatted(.iso8601.year().month().day()))"
            let gpx = GPXExporter.gpx(flightName: name + (f.eventName.map { " – \($0)" } ?? ""), samples: samples, isSimulated: f.isSimulated)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("retfast-\(f.id.uuidString.prefix(8)).gpx")
            if (try? gpx.write(to: url, atomically: true, encoding: .utf8)) != nil { gpxURL = url }
        }
    }
}

/// Static route map: track coloured by altitude, take-off and landing pins.
struct FlightRouteMap: View {
    let points: [TrackPoint]

    var body: some View {
        let coords = points.map(\.coordinate)
        Map(initialPosition: .automatic) {
            MapPolyline(coordinates: coords).stroke(.white.opacity(0.9), lineWidth: 6)
            MapPolyline(coordinates: coords).stroke(Brand.gradient, style: StrokeStyle(lineWidth: 3.5, lineCap: .round, lineJoin: .round))
            if let first = coords.first {
                Annotation(String(localized: "Kalkış"), coordinate: first) { pin("arrow.up", AeroTokens.success) }
            }
            if let last = coords.last {
                Annotation(String(localized: "İniş"), coordinate: last) { pin("arrow.down", AeroTokens.error) }
            }
        }
        .mapStyle(.hybrid(elevation: .realistic))
    }

    private func pin(_ icon: String, _ c: Color) -> some View {
        Image(icon: icon).font(.caption.weight(.bold)).foregroundStyle(.white)
            .frame(width: 24, height: 24).background(c, in: Circle())
            .overlay(Circle().stroke(.white, lineWidth: 2))
    }
}

/// A flight known only to the server: route from GET /flights/{id}/positions.
struct RemoteFlightDetailView: View {
    let flight: Flight
    @Environment(AppModel.self) private var model
    @State private var track = FlightTrack(raw: [])
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AeroTokens.Space.s4) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Text(flight.eventId == nil ? "Kişisel uçuş" : "Etkinlik uçuşu").font(.title2.bold())
                        if flight.isSimulated == true { SimBadge() }
                    }
                    if let d = flight.startedAt { Text(d.formatted(date: .complete, time: .shortened)).foregroundStyle(AeroTokens.textSecondary) }
                    StatusPill(String(localized: "Sunucuda"), systemImage: "checkmark.icloud", tone: .info)
                }
                if loading { ProgressView().frame(maxWidth: .infinity).padding() }
                if !track.isEmpty {
                    FlightTrackSummary(track: track, title: String(localized: "Uçuş"))
                }
                AeroCard {
                    SectionHeader(title: String(localized: "Sunucu kaydı"))
                    KeyValueRow(key: String(localized: "Durum"), value: flight.status)
                    KeyValueRow(key: String(localized: "Nokta"), value: "\(flight.stats?.sampleCount ?? 0) / \(flight.stats?.expectedSampleCount ?? 0)")
                    KeyValueRow(key: String(localized: "Boşluk"), value: "\(flight.stats?.gapCount ?? 0)")
                }
                if let error { WarningRow(text: error) }
            }
            .padding(AeroTokens.Space.s4)
        }
        .aeroBackground()
        .navigationTitle("Uçuş")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            defer { loading = false }
            do { track = FlightTrack(positions: try await model.api.positions(flightId: flight.id, simplify: false).items) }
            catch { self.error = ErrorText.message(error) }
        }
    }
}
