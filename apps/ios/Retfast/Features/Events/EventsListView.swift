import RetfastCore
import SwiftUI

/// Home: big header, my events as large cards, then events open to apply.
struct EventsListView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let mine = model.myEvents
        let others = model.otherEvents
        ScrollView {
            VStack(alignment: .leading, spacing: AeroTokens.Space.s4) {
                header
                notices
                if mine.isEmpty && !model.eventsLoading {
                    emptyMine
                }
                ForEach(mine) { e in card(e, style: .hero) }
                if !others.isEmpty {
                    Text("Keşfet ve başvur")
                        .font(.title3.bold())
                        .foregroundStyle(AeroTokens.textPrimary)
                        .padding(.top, AeroTokens.Space.s2)
                    ForEach(others) { e in card(e, style: .compact) }
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
        HStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 2) {
                Text(Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide)).uppercased(with: Locale(identifier: "tr_TR")))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AeroTokens.textSecondary)
                Text("Etkinlikler")
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(AeroTokens.textPrimary)
            }
            Spacer()
            Button { model.selectedTab = .profile } label: {
                Avatar(name: model.me?.fullName, size: 44, tint: AeroTokens.primary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Profil"))
        }
        .padding(.top, AeroTokens.Space.s4)
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
            BrandMark(size: 44, color: AeroTokens.textMuted)
            Text("Henüz bir etkinliğin yok").font(.headline)
            Text("Aşağıdan bir etkinliğe başvur. Organizatör onaylayınca rolünle burada görünür.")
                .font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
        }
    }

    private func card(_ e: Event, style: EventCard.Style) -> some View {
        NavigationLink(value: EventRoute.event(e.id)) { EventCard(event: e, style: style) }
            .buttonStyle(.plain)
            .accessibilityIdentifier("events.row.\(e.slug ?? e.id)")
    }
}

/// Large gradient event card with a date tile (reference: event list).
struct EventCard: View {
    enum Style { case hero, compact }
    let event: Event
    let style: Style

    private var gradient: LinearGradient {
        let top: Color = event.isMember ? Brand.red : Brand.blue
        return LinearGradient(colors: [top, top.opacity(0.55), Brand.ink],
                              startPoint: .topTrailing, endPoint: .bottomLeading)
    }

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            gradient
            BrandMark(size: style == .hero ? 260 : 150, color: .white.opacity(0.10))
                .offset(x: style == .hero ? 120 : 170, y: style == .hero ? -40 : -10)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    chips
                    Spacer()
                    dateTile
                }
                Spacer(minLength: AeroTokens.Space.s3)
                if let loc = event.locationName, !loc.isEmpty {
                    Text(loc).font(.subheadline.weight(.medium)).foregroundStyle(.white.opacity(0.8)).lineLimit(1)
                }
                Text(event.name)
                    .font(style == .hero ? .title.bold() : .title3.bold())
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                subtitle
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.85))
                    .padding(.top, 2)
            }
            .padding(AeroTokens.Space.s4)
        }
        .frame(height: style == .hero ? 230 : 150)
        .clipShape(RoundedRectangle(cornerRadius: AeroTokens.Radius.xl, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: AeroTokens.Radius.xl, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var chips: some View {
        HStack(spacing: 6) {
            if let role = event.memberRole { chip(role.title, role.systemImage) }
            if event.isOrganizer { chip(String(localized: "Organizatör"), "star.fill") }
            if event.status == "active" { chip(String(localized: "Canlı"), "dot.radiowaves.left.and.right") }
            if event.isDemo ?? false { chip("DEMO", "sparkles") }
        }
    }

    private func chip(_ text: String, _ icon: String) -> some View {
        Label(text, systemImage: icon)
            .font(.caption.weight(.semibold))
            .lineLimit(1)
            .foregroundStyle(.white)
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(.black.opacity(0.28), in: Capsule())
    }

    @ViewBuilder private var dateTile: some View {
        if let d = event.startsAt {
            VStack(spacing: 0) {
                Text(d.formatted(.dateTime.day())).font(.title2.bold())
                Text(d.formatted(.dateTime.month(.abbreviated)).uppercased(with: Locale(identifier: "tr_TR")))
                    .font(.caption2.weight(.semibold))
            }
            .foregroundStyle(Brand.ink)
            .frame(width: 54, height: 58)
            .background(.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    @ViewBuilder private var subtitle: some View {
        switch EventSheetMode.mode(for: event) {
        case .notMember(.pending): Label("Başvurun onay bekliyor", systemImage: "clock")
        case .notMember(.rejected): Label("Başvuru reddedildi", systemImage: "xmark.circle")
        case .notMember(.canApply): Label("Başvuruya açık", systemImage: "person.badge.plus")
        default:
            if event.isOrganizer, let n = event.counts?.pendingApplications, n > 0 {
                Label("\(n) başvuru bekliyor", systemImage: "tray.full")
            } else if let c = event.counts {
                Text("\(c.pilots ?? 0) pilot · \(c.retrievers ?? 0) retriever")
            } else {
                Text(EventDates.range(event))
            }
        }
    }
}
