import RetfastCore
import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @AppStorage("appearance") private var appearance = AppAppearance.system.rawValue

    var body: some View {
        @Bindable var model = model
        Group {
            if !model.onboardingCompleted {
                OnboardingView()
            } else {
                switch model.authPhase {
                case .loading:
                    // Matches the system launch screen; no artificial delay.
                    Brand.ink.ignoresSafeArea()
                        .overlay { BrandMark(size: 120, color: .white).accessibilityLabel(Text("Yükleniyor")) }
                case .signedOut:
                    AuthFlowView()
                case .mustChangePassword:
                    NavigationStack { ChangePasswordView(forced: true) }
                case .signedIn:
                    MainTabView()
                }
            }
        }
        .fullScreenCover(item: $model.overlay) { overlay in
            OverlayView(overlay: overlay)
                .environment(model)
        }
        .modifier(FlowSheets(active: model.overlay == nil))
        .preferredColorScheme(AppAppearance(rawValue: appearance)?.colorScheme)
        .tint(AeroTokens.primary)
    }
}

/// Content of the full-screen cover.
struct OverlayView: View {
    @Environment(AppModel.self) private var model
    let overlay: Overlay

    var body: some View {
        Group {
            switch overlay {
            case .flight: FlightComputerContainer()
            case .retrieval(let id): RetrievalWaitingView(retrievalId: id)
            }
        }
        .modifier(FlowSheets(active: true))
    }
}

/// Landing prompt and retrieve-request sheet. Attached both at the root and
/// inside the cover; `active` makes sure only the topmost one presents.
struct FlowSheets: ViewModifier {
    @Environment(AppModel.self) private var model
    let active: Bool

    func body(content: Content) -> some View {
        content
            .sheet(item: Binding(get: { active ? model.retrieveRequest : nil },
                                 set: { if active { model.retrieveRequest = $0 } })) { ctx in
                NavigationStack { RetrieveRequestView(context: ctx) }
                    .environment(model)
            }
            .alert("İndin mi?", isPresented: Binding(get: { active && model.showLandingPrompt },
                                                     set: { if active && !$0 { model.showLandingPrompt = false } })) {
                Button("Uçuşu bitir ve retrieve iste") {
                    model.showLandingPrompt = false
                    model.endFlightAndRequestRetrieve()
                }
                Button("Uçuşu bitir, retrieve gerekmez") {
                    model.showLandingPrompt = false
                    model.endFlight()
                    model.overlay = .flight
                }
                Button("Hâlâ uçuyorum", role: .cancel) { model.snoozeLandingPrompt() }
            } message: {
                Text("Hızın ve irtifa değişimin bir süredir çok düşük. Uçuş kaydı sen bitirene kadar devam eder.")
            }
    }
}

struct MainTabView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.selectedTab) {
            NavigationStack(path: $model.eventsPath) {
                EventsListView()
                    .navigationDestination(for: EventRoute.self) { route in
                        switch route {
                        case .event(let id): EventScreen(eventId: id)
                        case .applications(let id): ApplicationsInboxView(eventId: id)
                        case .members(let id): MembersListView(eventId: id)
                        }
                    }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { ActivityBar() }
            .tabItem { Label("Etkinlikler", systemImage: "flag.2.crossed") }
            .tag(AppTab.events)

            NavigationStack { FlightsListView() }
                .safeAreaInset(edge: .bottom, spacing: 0) { ActivityBar() }
                .tabItem { Label("Uçuşlarım", systemImage: "point.topleft.down.to.point.bottomright.curvepath") }
                .tag(AppTab.flights)

            NavigationStack { ProfileView() }
                .safeAreaInset(edge: .bottom, spacing: 0) { ActivityBar() }
                .tabItem { Label("Profil", systemImage: "person.crop.circle") }
                .tag(AppTab.profile)
        }
    }
}

/// Persistent "resume" entry above the tab bar while a flight records, a
/// retrieve is open or retriever duty shares the position.
struct ActivityBar: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            if model.session.isActive && !model.isShowingFlightEvent {
                bar(tone: .active, accessibilityId: "activity.flight") {
                    model.openFlightEvent()
                } content: {
                    Image(systemName: model.session.state.systemImage)
                        .symbolEffect(.pulse, isActive: model.session.state == .recording)
                    Text(model.session.state.title).font(.subheadline.weight(.semibold))
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text(Fmt.duration(context.date.timeIntervalSince(model.session.flight?.startedAt ?? context.date)))
                            .font(.subheadline.monospacedDigit())
                    }
                    Spacer(minLength: 4)
                    Text("Uçuşa dön").font(.subheadline)
                }
            }
            if let r = model.activeRetrieval, model.overlay != .retrieval(r.id) {
                bar(tone: .info, accessibilityId: "activity.retrieval") {
                    model.overlay = .retrieval(r.id)
                } content: {
                    Image(systemName: r.stage.systemImage)
                    Text(r.stage.shortTitle).font(.subheadline.weight(.semibold)).lineLimit(1)
                    if let name = r.server?.retriever?.fullName, r.stage == .accepted {
                        Text("· \(name)").font(.subheadline).lineLimit(1)
                    }
                    Spacer(minLength: 4)
                    Text("Retrieve").font(.subheadline)
                }
            }
            if case .retriever(let eventId) = model.sharing.mode, model.activeRetrieval == nil {
                bar(tone: .success, accessibilityId: "activity.duty") {
                    model.selectedTab = .events
                    if model.eventsPath.last != .event(eventId) { model.eventsPath = [.event(eventId)] }
                } content: {
                    Image(systemName: "car.fill")
                    Text("Retrieve görevi").font(.subheadline.weight(.semibold))
                    let n = model.retrieverDuty?.activePickups ?? 0
                    if n > 0 { Text("· \(n) alım").font(.subheadline) }
                    Spacer(minLength: 4)
                    Text("Konum paylaşılıyor").font(.caption)
                }
            }
        }
    }

    private func bar<C: View>(tone: Tone, accessibilityId: String, action: @escaping () -> Void,
                              @ViewBuilder content: () -> C) -> some View {
        Button(action: action) {
            HStack(spacing: AeroTokens.Space.s2) {
                content()
                Image(systemName: "chevron.up")
            }
            .foregroundStyle(tone == .info ? AeroTokens.onSecondary : AeroTokens.onPrimary)
            .padding(.horizontal, AeroTokens.Space.s4)
            .padding(.vertical, AeroTokens.Space.s2)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(tone == .info ? AeroTokens.secondary : (tone == .success ? AeroTokens.success : AeroTokens.trackingActive), in: Capsule())
            .shadow(color: .black.opacity(0.18), radius: 8, y: 2)
            .padding(.horizontal, AeroTokens.Space.s3)
            .padding(.vertical, AeroTokens.Space.s1)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(accessibilityId)
    }
}
