import RetfastCore
import SwiftUI

struct HomeView: View {
    @Environment(AppModel.self) private var model
    @State private var showPreFlight = false
    @State private var recent: [LocalFlight] = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AeroTokens.Space.s4) {
                header
                if model.isOfflineSession {
                    AeroCard { WarningRow(text: String(localized: "Çevrimdışı mod: sunucuya ulaşılamıyor. Uçuş kaydı çalışır; veriler bağlantı gelince gönderilir."), tone: .warning, systemImage: "wifi.slash") }
                }
                if let fatal = model.storeFatalError {
                    AeroCard { WarningRow(text: String(localized: "Yerel veritabanı açılamadı; kayıtlar yalnızca bellekte tutuluyor. Destek: \(fatal)"), tone: .error) }
                }
                if model.store.recoveryEvent != nil {
                    AeroCard { WarningRow(text: String(localized: "Yerel veritabanı bozuk bulundu ve yenisi oluşturuldu. Eski dosya saklandı; ayrıntılar Tanılama ekranında."), tone: .error) }
                }
                trackingCard
                flightButton
                if let event = model.suggestedEvent { activeEventCard(event) }
                if let last = recent.first(where: { $0.state == .completed }) { lastFlightCard(last) }
                if recent.count > 1 { recentFlights }
                notifications
                Button {
                    model.showSOS = true
                } label: {
                    Label("Acil durum (SOS)", systemImage: "sos")
                }
                .buttonStyle(PrimaryButtonStyle(kind: .emergency))
                .accessibilityIdentifier("home.sos")
            }
            .padding(AeroTokens.Space.s4)
        }
        .aeroBackground()
        .navigationTitle("Retfast")
        .refreshable {
            await model.refreshEvents()
            await model.refreshNotifications()
            loadRecent()
        }
        .sheet(isPresented: $showPreFlight) {
            NavigationStack { PreFlightCheckView() }.environment(model)
        }
        .onAppear(perform: loadRecent)
        .onChange(of: model.session.state) { _, _ in loadRecent() }
    }

    private func loadRecent() { recent = (try? model.store.recentFlights(limit: 5)) ?? [] }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Merhaba, \(model.me?.pilot?.displayName ?? model.me?.fullName ?? "")")
                .font(.title2.bold())
            Text(Date().formatted(date: .complete, time: .omitted)).foregroundStyle(AeroTokens.textSecondary)
        }
    }

    private var trackingCard: some View {
        AeroCard {
            HStack {
                Text("Takip durumu").font(.headline)
                Spacer()
                StatusPill(String(localized: model.session.isActive ? "Kayıt açık" : "Kayıt kapalı"),
                           systemImage: model.session.state.systemImage, tone: model.session.state.tone)
            }
            HStack {
                SyncBadge(snapshot: model.syncSnapshot)
                Spacer()
                if let ack = model.syncSnapshot.lastServerAck {
                    Text("Son onay \(Fmt.relative(ack))").font(.caption).foregroundStyle(AeroTokens.textSecondary)
                }
            }
            if model.session.authorization.status != .always {
                WarningRow(text: String(localized: "Konum izni \"Her Zaman\" değil. Uçuş öncesi kontrolde ayrıntıları görün."))
            }
        }
    }

    @ViewBuilder private var flightButton: some View {
        if model.session.isActive {
            Button {
                model.showFlightComputer = true
            } label: {
                Label("Uçuşa dön", systemImage: "airplane")
            }
            .buttonStyle(.aeroPrimaryLarge)
            .accessibilityIdentifier("home.resume")
        } else {
            Button {
                showPreFlight = true
            } label: {
                Label("Uçuşa başla", systemImage: "play.fill")
            }
            .buttonStyle(.aeroPrimaryLarge)
            .accessibilityIdentifier("home.start")
        }
    }

    private func activeEventCard(_ e: Event) -> some View {
        NavigationLink {
            EventDetailView(event: e)
        } label: {
            AeroCard {
                HStack {
                    Text("Aktif etkinlik").font(.caption.weight(.semibold)).textCase(.uppercase).foregroundStyle(AeroTokens.textSecondary)
                    Spacer()
                    if e.isDemo == true { StatusPill("DEMO", systemImage: "testtube.2", tone: .info) }
                }
                Text(e.name).font(.headline).foregroundStyle(AeroTokens.textPrimary)
                if let loc = e.locationName { Text(loc).font(.subheadline).foregroundStyle(AeroTokens.textSecondary) }
            }
        }
        .buttonStyle(.plain)
    }

    private func lastFlightCard(_ f: LocalFlight) -> some View {
        NavigationLink {
            FlightDetailView(flightId: f.id)
        } label: {
            AeroCard {
                Text("Son uçuş").font(.caption.weight(.semibold)).textCase(.uppercase).foregroundStyle(AeroTokens.textSecondary)
                HStack {
                    Text(Fmt.dateTime(f.startedAt)).font(.headline).foregroundStyle(AeroTokens.textPrimary)
                    if f.isSimulated { SimBadge() }
                    Spacer()
                    Text(Fmt.duration((f.endedAt ?? f.lastSampleAt ?? f.startedAt).timeIntervalSince(f.startedAt))).font(.body.monospacedDigit())
                }
                FlightSyncPill(flight: f)
            }
        }
        .buttonStyle(.plain)
    }

    private var recentFlights: some View {
        VStack(alignment: .leading, spacing: AeroTokens.Space.s2) {
            SectionHeader(title: String(localized: "Son uçuşlar"))
            ForEach(recent.prefix(4).dropFirst()) { f in
                NavigationLink { FlightDetailView(flightId: f.id) } label: { FlightRow(flight: f) }
                    .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder private var notifications: some View {
        if !model.notifications.isEmpty {
            VStack(alignment: .leading, spacing: AeroTokens.Space.s2) {
                SectionHeader(title: String(localized: "Bildirimler"))
                ForEach(model.notifications.prefix(5)) { n in
                    AeroCard {
                        HStack(alignment: .top) {
                            Image(systemName: n.kind == "emergency_alert" ? "exclamationmark.triangle.fill" : "bell")
                                .foregroundStyle(n.kind == "emergency_alert" ? AeroTokens.emergencyText : AeroTokens.secondary)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(n.title).font(.subheadline.weight(.semibold))
                                if let b = n.body { Text(b).font(.subheadline).foregroundStyle(AeroTokens.textSecondary) }
                                Text(Fmt.relative(n.createdAt)).font(.caption).foregroundStyle(AeroTokens.textMuted)
                            }
                            Spacer()
                            if n.readAt == nil {
                                Button("Okundu") { Task { try? await model.api.markNotificationRead(n.id); await model.refreshNotifications() } }
                                    .font(.caption)
                            }
                        }
                    }
                }
            }
        }
    }
}
