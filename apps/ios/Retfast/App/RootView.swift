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
                    AeroTokens.background.ignoresSafeArea()
                        .overlay { ProgressView().accessibilityLabel(Text("Yükleniyor")) }
                case .signedOut:
                    AuthFlowView()
                case .mustChangePassword:
                    NavigationStack { ChangePasswordView(forced: true) }
                case .signedIn:
                    MainTabView()
                }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if model.session.isActive && !model.showFlightComputer {
                ActiveFlightBanner()
            }
        }
        .fullScreenCover(isPresented: $model.showFlightComputer) {
            FlightComputerContainer()
                .environment(model)
        }
        .preferredColorScheme(AppAppearance(rawValue: appearance)?.colorScheme)
        .tint(AeroTokens.primary)
    }
}

/// Visible on every screen while a flight is recording but the flight computer is closed.
struct ActiveFlightBanner: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Button {
            model.showFlightComputer = true
        } label: {
            HStack(spacing: AeroTokens.Space.s2) {
                Image(systemName: model.session.state.systemImage)
                    .symbolEffect(.pulse, isActive: model.session.state == .recording)
                Text(model.session.state.title)
                    .font(.subheadline.weight(.semibold))
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(Fmt.duration(context.date.timeIntervalSince(model.session.flight?.startedAt ?? context.date)))
                        .font(.subheadline.monospacedDigit())
                }
                Spacer()
                Text("Uçuş ekranı").font(.subheadline)
                Image(systemName: "chevron.right")
            }
            .foregroundStyle(AeroTokens.onPrimary)
            .padding(.horizontal, AeroTokens.Space.s4)
            .padding(.vertical, AeroTokens.Space.s2)
            .frame(maxWidth: .infinity)
            .background(AeroTokens.trackingActive)
        }
        .buttonStyle(.plain)
        .accessibilityHint(Text("Uçuş bilgisayarını açar"))
    }
}

struct MainTabView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.selectedTab) {
            NavigationStack { HomeView() }
                .tabItem { Label("Ana Sayfa", systemImage: "house") }
                .tag(AppTab.home)
            NavigationStack { ExploreView() }
                .tabItem { Label("Keşfet", systemImage: "map") }
                .tag(AppTab.explore)
            NavigationStack { FlightsListView() }
                .tabItem { Label("Uçuşlar", systemImage: "point.topleft.down.to.point.bottomright.curvepath") }
                .tag(AppTab.flights)
            if model.showsRescue {
                NavigationStack { RescueDashboardView() }
                    .tabItem { Label("Kurtarma", systemImage: "cross.case") }
                    .tag(AppTab.rescue)
            }
            NavigationStack { ProfileView() }
                .tabItem { Label("Profil", systemImage: "person.crop.circle") }
                .tag(AppTab.profile)
        }
        .sheet(isPresented: Binding(get: { model.showSOS && !model.showFlightComputer }, set: { model.showSOS = $0 })) {
            NavigationStack { SOSView() }.environment(model)
        }
    }
}
