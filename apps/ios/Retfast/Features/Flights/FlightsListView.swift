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
            } else if let error = flight.lastError, !flight.serverCreated {
                StatusPill(String(localized: "Sunucu kabul etmedi (\(error))"), systemImage: "exclamationmark.icloud", tone: .error)
            } else if counts.pending > 0 {
                StatusPill(String(localized: "Bekleyen \(counts.pending)"), systemImage: "icloud.and.arrow.up", tone: .warning)
            } else if !flight.serverEnded && flight.state == .completed {
                StatusPill(String(localized: "Bitiş bekleniyor"), systemImage: "icloud.and.arrow.up", tone: .warning)
            } else {
                StatusPill(String(localized: "Senkronize") + (counts.rejected > 0 ? String(localized: " · \(counts.rejected) reddedildi") : ""),
                           systemImage: "checkmark.icloud", tone: .success)
            }
        }
        .task(id: model.syncSnapshot) { counts = (try? model.store.syncCounts(flightId: flight.id)) ?? counts }
    }
}

struct FlightRow: View {
    let flight: LocalFlight
    var body: some View {
        AeroCard(padding: AeroTokens.Space.s3) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(Fmt.dateTime(flight.startedAt)).font(.headline)
                        if flight.isSimulated { SimBadge() }
                    }
                    Text(flight.eventName ?? String(localized: "Kişisel uçuş")).font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
                }
                Spacer()
                Text(Fmt.duration((flight.endedAt ?? flight.lastSampleAt ?? flight.startedAt).timeIntervalSince(flight.startedAt)))
                    .font(.body.monospacedDigit())
            }
            FlightSyncPill(flight: flight)
        }
    }
}

struct FlightsListView: View {
    @Environment(AppModel.self) private var model
    @State private var local: [LocalFlight] = []
    @State private var remote: [Flight] = []
    @State private var remoteError: String?

    /// Server flights not on this device (other phone, reinstall, pruned).
    private var remoteOnly: [Flight] {
        let ids = Set(local.map { $0.id.uuidString.lowercased() })
        return remote.filter { !ids.contains($0.id.lowercased()) }
    }

    var body: some View {
        List {
            if local.isEmpty && remoteOnly.isEmpty {
                ContentUnavailableView("Henüz uçuş yok", systemImage: "point.topleft.down.to.point.bottomright.curvepath",
                                       description: Text("Ana sayfadan bir uçuş başlattığınızda burada görünür."))
                    .listRowBackground(Color.clear)
            }
            if !local.isEmpty {
                Section("Bu cihazda") {
                    ForEach(local) { f in
                        NavigationLink { FlightDetailView(flightId: f.id) } label: { FlightRow(flight: f) }
                            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color.clear)
                    }
                }
            }
            if !remoteOnly.isEmpty {
                Section("Sunucuda") {
                    ForEach(remoteOnly) { f in
                        NavigationLink { RemoteFlightDetailView(flight: f) } label: {
                            HStack {
                                Text(Fmt.dateTime(f.startedAt))
                                if f.isSimulated == true { SimBadge() }
                                Spacer()
                                Text(Fmt.duration(f.stats?.durationS ?? 0)).monospacedDigit()
                            }
                        }
                    }
                }
            }
            if let remoteError {
                Section { WarningRow(text: remoteError, tone: .warning) }
            }
        }
        .listStyle(.plain)
        .aeroBackground()
        .navigationTitle("Uçuşlar")
        .task { await load() }
        .refreshable { await load() }
        .onChange(of: model.session.state) { _, _ in local = (try? model.store.recentFlights(limit: 200)) ?? local }
    }

    private func load() async {
        local = (try? model.store.recentFlights(limit: 200)) ?? []
        do {
            remote = try await model.api.flights().items
            remoteError = nil
        } catch {
            remoteError = String(localized: "Sunucudaki uçuşlar alınamadı: ") + ErrorText.message(error)
        }
    }
}

struct ChartPoint: Identifiable {
    let id: Int
    let t: Date
    let altitude: Double?
    let speed: Double?
}

struct FlightDetailView: View {
    let flightId: UUID
    @Environment(AppModel.self) private var model
    @State private var flight: LocalFlight?
    @State private var samples: [TelemetrySample] = []
    @State private var stats = FlightComputerValues()
    @State private var counts = LocalTelemetryStore.SyncCounts()
    @State private var gpxURL: URL?

    var body: some View {
        List {
            if samples.count > 1 {
                Section {
                    FlightRouteMap(coordinates: samples.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) })
                        .frame(height: 260)
                        .listRowInsets(EdgeInsets())
                }
            }
            if let f = flight {
                Section("İstatistikler") {
                    if f.isSimulated { HStack { SimBadge(); Text("Simüle edilmiş uçuş") } }
                    KeyValueRow(key: String(localized: "Etkinlik"), value: f.eventName ?? String(localized: "Kişisel uçuş"))
                    KeyValueRow(key: String(localized: "Başlangıç"), value: Fmt.dateTime(f.startedAt))
                    KeyValueRow(key: String(localized: "Süre"), value: Fmt.duration((f.endedAt ?? f.lastSampleAt ?? f.startedAt).timeIntervalSince(f.startedAt)), mono: true)
                    KeyValueRow(key: String(localized: "Mesafe"), value: joined(Fmt.distance(stats.distance)), mono: true)
                    KeyValueRow(key: String(localized: "Maks GPS irtifa"), value: joined(Fmt.altitude(stats.maxAltitude)), mono: true)
                    KeyValueRow(key: String(localized: "Maks yer hızı"), value: joined(Fmt.speed(stats.maxGroundSpeed)), mono: true)
                    KeyValueRow(key: String(localized: "Toplam tırmanış"), value: joined(Fmt.altitude(stats.totalAscent)), mono: true)
                    KeyValueRow(key: String(localized: "Toplam alçalma"), value: joined(Fmt.altitude(stats.totalDescent)), mono: true)
                    KeyValueRow(key: String(localized: "Görünürlük"), value: f.visibility)
                    if f.interruptionCount > 0 { KeyValueRow(key: String(localized: "Kesinti"), value: "\(f.interruptionCount)") }
                }
                Section("Konum") {
                    KeyValueRow(key: String(localized: "Başlangıç"), value: Fmt.coordinate(samples.first?.lat, samples.first?.lon), mono: true)
                    KeyValueRow(key: String(localized: "Bitiş"), value: Fmt.coordinate(samples.last?.lat, samples.last?.lon), mono: true)
                }
                Section("GPS kalitesi") {
                    let lowQ = samples.filter(\.lowQuality).count
                    let avg = samples.isEmpty ? nil : samples.map(\.hAcc).reduce(0, +) / Double(samples.count)
                    KeyValueRow(key: String(localized: "Nokta sayısı"), value: "\(samples.count)")
                    KeyValueRow(key: String(localized: "Ortalama doğruluk"), value: Fmt.accuracy(avg))
                    KeyValueRow(key: String(localized: "Düşük kaliteli (>50 m)"), value: "\(lowQ)")
                    KeyValueRow(key: String(localized: "En uzun boşluk"), value: Fmt.age(longestGap))
                }
                Section("Senkronizasyon") {
                    FlightSyncPill(flight: f)
                    KeyValueRow(key: String(localized: "Sunucuya ulaşan"), value: "\(counts.synced)")
                    KeyValueRow(key: String(localized: "Bekleyen"), value: "\(counts.pending)")
                    KeyValueRow(key: String(localized: "Reddedilen"), value: "\(counts.rejected)")
                }
            }
            if chartPoints.count > 2 {
                Section("GPS irtifa") {
                    Chart(chartPoints.filter { $0.altitude != nil }) {
                        LineMark(x: .value("Zaman", $0.t), y: .value("İrtifa", Units.current == .metric ? $0.altitude! : $0.altitude! * 3.28084))
                            .foregroundStyle(AeroTokens.primary)
                    }
                    .chartYAxisLabel(Units.current == .metric ? "m" : "ft")
                    .frame(height: 180)
                }
                Section("Yer hızı") {
                    Chart(chartPoints.filter { $0.speed != nil }) {
                        LineMark(x: .value("Zaman", $0.t), y: .value("Hız", Units.current == .metric ? $0.speed! * 3.6 : $0.speed! * 2.23694))
                            .foregroundStyle(AeroTokens.secondary)
                    }
                    .chartYAxisLabel(Units.current == .metric ? "km/h" : "mph")
                    .frame(height: 180)
                }
            }
            if let gpxURL {
                Section {
                    ShareLink(item: gpxURL) {
                        Label("GPX dışa aktar", systemImage: "square.and.arrow.up")
                    }
                } footer: {
                    Text("GPX dosyası telefondaki ham GPS noktalarından oluşturulur. Sertifikalı bir uçuş kaydı (IGC) değildir ve yarışma/rekor kanıtı olarak kullanılamaz.")
                }
            }
        }
        .navigationTitle("Uçuş")
        .navigationBarTitleDisplayMode(.inline)
        .task { load() }
    }

    private func joined(_ p: (String, String)) -> String { p.0 == Fmt.dash ? Fmt.dash : "\(p.0) \(p.1)" }

    private var longestGap: TimeInterval {
        zip(samples, samples.dropFirst()).map { $1.t.timeIntervalSince($0.t) }.max() ?? 0
    }

    private var chartPoints: [ChartPoint] {
        let stride = max(1, samples.count / 600)
        return Swift.stride(from: 0, to: samples.count, by: stride).map {
            let s = samples[$0]
            return ChartPoint(id: s.seq, t: s.t, altitude: s.altitude, speed: s.speed)
        }
    }

    private func load() {
        flight = try? model.store.flight(id: flightId)
        samples = (try? model.store.samples(flightId: flightId)) ?? []
        var p = TelemetryProcessor()
        p.replay(samples)
        stats = p.values
        counts = (try? model.store.syncCounts(flightId: flightId)) ?? counts
        if let f = flight, !samples.isEmpty {
            let name = "Retfast \(f.startedAt.formatted(.iso8601.year().month().day()))"
            let gpx = GPXExporter.gpx(flightName: name + (f.eventName.map { " – \($0)" } ?? ""), samples: samples, isSimulated: f.isSimulated)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("retfast-\(f.id.uuidString.prefix(8)).gpx")
            if (try? gpx.write(to: url, atomically: true, encoding: .utf8)) != nil { gpxURL = url }
        }
    }
}

struct FlightRouteMap: View {
    let coordinates: [CLLocationCoordinate2D]
    var body: some View {
        Map(initialPosition: .automatic) {
            MapPolyline(coordinates: coordinates).stroke(AeroTokens.primary, lineWidth: 3)
            if let first = coordinates.first {
                Annotation(String(localized: "Kalkış"), coordinate: first) { Image(systemName: "arrow.up.circle.fill").foregroundStyle(AeroTokens.success) }
            }
            if let last = coordinates.last {
                Annotation(String(localized: "İniş"), coordinate: last) { Image(systemName: "arrow.down.circle.fill").foregroundStyle(AeroTokens.error) }
            }
        }
        .mapStyle(.standard(elevation: .realistic))
    }
}

/// A flight known only to the server: route from GET /flights/{id}/positions.
struct RemoteFlightDetailView: View {
    let flight: Flight
    @Environment(AppModel.self) private var model
    @State private var positions: [Position] = []
    @State private var error: String?

    var body: some View {
        List {
            if positions.count > 1 {
                Section {
                    FlightRouteMap(coordinates: positions.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) })
                        .frame(height: 260).listRowInsets(EdgeInsets())
                }
            }
            Section("İstatistikler (sunucu)") {
                KeyValueRow(key: String(localized: "Durum"), value: flight.status)
                KeyValueRow(key: String(localized: "Süre"), value: Fmt.duration(flight.stats?.durationS ?? 0), mono: true)
                KeyValueRow(key: String(localized: "Mesafe"), value: Fmt.distance(flight.stats?.distanceM).0 + " " + Fmt.distance(flight.stats?.distanceM).1)
                KeyValueRow(key: String(localized: "Maks GPS irtifa"), value: Fmt.altitude(flight.stats?.maxGpsAltM).0)
                KeyValueRow(key: String(localized: "Nokta"), value: "\(flight.stats?.sampleCount ?? 0) / \(flight.stats?.expectedSampleCount ?? 0)")
                KeyValueRow(key: String(localized: "Boşluk"), value: "\(flight.stats?.gapCount ?? 0)")
            }
            if let error { Section { WarningRow(text: error) } }
        }
        .navigationTitle("Uçuş")
        .task {
            do { positions = try await model.api.positions(flightId: flight.id, simplify: true).items }
            catch { self.error = ErrorText.message(error) }
        }
    }
}
