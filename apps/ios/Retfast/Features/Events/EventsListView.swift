import RetfastCore
import SwiftUI

/// Home: "Today" header, a stats card, then my events and events open to apply as cards.
struct EventsListView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let all = model.myEvents
        let hero = all.first { $0.status == "active" }
        let mine = all.filter { $0.id != hero?.id }
        let others = model.otherEvents
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header
                notices
                if let hero { heroCard(hero) }
                pendingNotice(all)
                if !mine.isEmpty || hero == nil {
                    SectionTitle(hero == nil ? String(localized: "Etkinliklerim") : String(localized: "Diğer etkinliklerim"), count: mine.count)
                        .padding(.top, 10)
                        .padding(.horizontal, 4)
                }
                if all.isEmpty && !model.eventsLoading {
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

    /// The event happening now, front and centre with one clear next step.
    private func heroCard(_ e: Event) -> some View {
        let pilot = e.memberRole == .pilot
        return NavigationLink(value: EventRoute.event(e.id)) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    Circle().fill(AeroTokens.primary).frame(width: 7, height: 7)
                    Text("Şu an canlı").font(.footnote.weight(.semibold)).foregroundStyle(AeroTokens.primary)
                    Spacer()
                    if let role = e.memberRole {
                        Label(role.title, icon: role.systemImage)
                            .font(.footnote.weight(.medium)).foregroundStyle(AeroTokens.textSecondary)
                    }
                }
                Text(e.name)
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(AeroTokens.textPrimary)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)
                    .padding(.top, 10)
                Group {
                    if let loc = e.locationName, !loc.isEmpty {
                        Text(loc + " · " + EventDates.range(e))
                    } else {
                        Text(EventDates.range(e))
                    }
                }
                .font(.footnote).foregroundStyle(AeroTokens.textSecondary).lineLimit(1)
                .padding(.top, 4)
                HStack(spacing: 8) {
                    Text(pilot ? "Uçuşa hazırlan" : "Etkinliği aç")
                    Image(icon: "arrow.right").font(.system(size: 14, weight: .bold))
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AeroTokens.onPrimary)
                .frame(maxWidth: .infinity, minHeight: 50)
                .background(AeroTokens.primary, in: Capsule())
                .padding(.top, AeroTokens.Space.s4)
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous)
                    .fill(AeroTokens.surface)
                    .overlay(alignment: .topTrailing) {
                        Circle().fill(AeroTokens.primary.opacity(0.16)).frame(width: 220).blur(radius: 60).offset(x: 70, y: -90)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
            )
            .contentShape(RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("events.row.\(e.slug ?? e.id)")
    }

    @ViewBuilder private func pendingNotice(_ mine: [Event]) -> some View {
        let pending = mine.filter(\.isOrganizer).compactMap { $0.counts?.pendingApplications }.reduce(0, +)
        if pending > 0 {
            Label("\(pending) başvuru onay bekliyor", icon: "tray.full")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(AeroTokens.warning)
                .padding(.horizontal, 16).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .background(AeroTokens.warning.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
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
