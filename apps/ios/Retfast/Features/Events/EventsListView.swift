import RetfastCore
import SwiftUI

/// Home: "Today" header, a stats card, then my events and events open to apply as cards.
struct EventsListView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let mine = model.myEvents
        let others = model.otherEvents
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header
                notices
                statsCard(mine)
                SectionTitle(String(localized: "Etkinliklerim"), count: mine.count)
                    .padding(.top, 10)
                    .padding(.horizontal, 4)
                if mine.isEmpty && !model.eventsLoading {
                    emptyMine
                }
                ForEach(mine) { e in card(e) }
                if !others.isEmpty {
                    SectionTitle(String(localized: "Keşfet ve başvur"), count: others.count)
                        .padding(.top, 14)
                        .padding(.horizontal, 4)
                    ForEach(others) { e in card(e) }
                }
            }
            .padding(.horizontal, AeroTokens.Space.s4)
            .padding(.bottom, AeroTokens.Space.s8)
        }
        .aeroBackground()
        .toolbar(.hidden, for: .navigationBar)
        .overlay { if model.eventsLoading && model.events.isEmpty { ProgressView() } }
        .refreshable { await model.refreshEvents() }
        .task { if model.events.isEmpty { await model.refreshEvents() } }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Button { model.selectedTab = .profile } label: {
                Avatar(name: model.me?.fullName, size: 46, tint: AeroTokens.primary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Profil"))
            VStack(alignment: .leading, spacing: 0) {
                Text("Bugün, \(Date.now.formatted(.dateTime.day().month(.abbreviated)))")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(AeroTokens.textPrimary)
                Text("Etkinlikler")
                    .font(.footnote)
                    .foregroundStyle(AeroTokens.textSecondary)
            }
            Spacer()
            HeaderCircleButton(systemImage: "arrow.clockwise", label: "Yenile") {
                Task { await model.refreshEvents() }
            }
        }
        .padding(.top, AeroTokens.Space.s2)
        .padding(.bottom, AeroTokens.Space.s2)
    }

    private func statsCard(_ mine: [Event]) -> some View {
        let active = mine.filter { $0.status == "active" }.count
        let pending = mine.compactMap { $0.counts?.pendingApplications }.reduce(0, +)
        return AeroCard {
            HStack {
                Text("Özet").font(.headline).foregroundStyle(AeroTokens.textPrimary)
                Spacer()
                if active > 0 { StatusPill(String(localized: "Canlı"), systemImage: "dot.radiowaves.left.and.right", tone: .active) }
            }
            HStack(spacing: 10) {
                StatTile(value: "\(mine.count)", label: String(localized: "Etkinliğim"))
                StatTile(value: "\(active)", label: String(localized: "Şu an aktif"))
                StatTile(value: "\(model.otherEvents.count)", label: String(localized: "Açık etkinlik"))
            }
            if pending > 0 {
                Label("\(pending) başvuru onay bekliyor", icon: "tray.full")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(AeroTokens.warning)
                    .padding(.horizontal, 14).frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                    .background(AeroTokens.warning.opacity(0.14), in: Capsule())
            }
        }
    }

    @ViewBuilder private var notices: some View {
        if model.isOfflineSession {
            AeroCard {
                WarningRow(text: String(localized: "Çevrimdışı: sunucuya ulaşılamıyor. Uçuş kaydı yine de yapılır; veriler bağlantı gelince gönderilir."),
                           systemImage: "wifi.slash")
            }
        }
        if let fatal = model.storeFatalError {
            AeroCard { WarningRow(text: String(localized: "Yerel veritabanı açılamadı; bu oturumda kayıtlar telefonda kalıcı değil. (\(fatal))"), tone: .error) }
        }
        if let error = model.eventsError, model.events.isEmpty {
            AeroCard {
                WarningRow(text: error, tone: .warning)
                Button("Tekrar dene") { Task { await model.refreshEvents() } }.buttonStyle(.aeroSecondary)
            }
        }
    }

    private var emptyMine: some View {
        AeroCard(padding: AeroTokens.Space.s6) {
            Image(icon: "calendar")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(AeroTokens.textSecondary)
                .frame(width: 52, height: 52)
                .background(AeroTokens.surfaceElevated, in: Circle())
            Text("Henüz bir etkinliğin yok").font(.headline)
            Text("Aşağıdan bir etkinliğe başvur. Organizatör onaylayınca rolünle burada görünür.")
                .font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
        }
    }

    private func card(_ e: Event) -> some View {
        NavigationLink(value: EventRoute.event(e.id)) { EventCard(event: e) }
            .buttonStyle(.plain)
            .accessibilityIdentifier("events.row.\(e.slug ?? e.id)")
    }
}

/// Event card: date tile, name, place and role pills on a graphite surface.
struct EventCard: View {
    let event: Event

    var body: some View {
        let live = event.status == "active"
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 14) {
                DateTile(date: event.startsAt, active: live)
                VStack(alignment: .leading, spacing: 3) {
                    Text(event.name)
                        .font(.headline)
                        .foregroundStyle(AeroTokens.textPrimary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    if let loc = event.locationName, !loc.isEmpty {
                        Label(loc, icon: "mappin.and.ellipse")
                            .font(.footnote)
                            .foregroundStyle(AeroTokens.textSecondary)
                            .lineLimit(1)
                    }
                    subtitle
                        .font(.footnote)
                        .foregroundStyle(AeroTokens.textMuted)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(icon: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(AeroTokens.textMuted)
                    .frame(width: 30, height: 30)
                    .background(AeroTokens.surfaceElevated, in: Circle())
            }
            if hasChips { chips }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AeroTokens.surface, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var hasChips: Bool {
        event.memberRole != nil || event.isOrganizer || event.status == "active" || (event.isDemo ?? false)
    }

    private var chips: some View {
        HStack(spacing: 6) {
            if event.status == "active" { StatusPill(String(localized: "Canlı"), systemImage: "dot.radiowaves.left.and.right", tone: .active) }
            if let role = event.memberRole { StatusPill(role.title, systemImage: role.systemImage, tone: .neutral) }
            if event.isOrganizer { StatusPill(String(localized: "Organizatör"), systemImage: "star.fill", tone: .info) }
            if event.isDemo ?? false { StatusPill("DEMO", systemImage: "sparkles", tone: .warning) }
        }
    }

    @ViewBuilder private var subtitle: some View {
        switch EventSheetMode.mode(for: event) {
        case .notMember(.pending): Label("Başvurun onay bekliyor", icon: "clock")
        case .notMember(.rejected): Label("Başvuru reddedildi", icon: "xmark.circle")
        case .notMember(.canApply): Label("Başvuruya açık", icon: "person.badge.plus")
        default:
            if event.isOrganizer, let n = event.counts?.pendingApplications, n > 0 {
                Label("\(n) başvuru bekliyor", icon: "tray.full")
            } else {
                Text(EventDates.range(event))
            }
        }
    }
}
