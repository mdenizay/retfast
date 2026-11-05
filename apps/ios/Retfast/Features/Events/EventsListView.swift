import RetfastCore
import SwiftUI

/// Home tab: my events (with role badge) first, then events to discover/apply.
struct EventsListView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""

    private func matches(_ e: Event) -> Bool {
        query.isEmpty || e.name.localizedCaseInsensitiveContains(query)
            || (e.locationName ?? "").localizedCaseInsensitiveContains(query)
    }

    var body: some View {
        let mine = model.myEvents.filter(matches)
        let others = model.otherEvents.filter(matches)
        List {
            if model.isOfflineSession {
                Section {
                    WarningRow(text: String(localized: "Çevrimdışı: sunucuya ulaşılamıyor. Uçuş kaydı yine de yapılır; veriler bağlantı gelince gönderilir."),
                               systemImage: "wifi.slash")
                }
            }
            if let fatal = model.storeFatalError {
                Section { WarningRow(text: String(localized: "Yerel veritabanı açılamadı; bu oturumda kayıtlar telefonda kalıcı değil. (\(fatal))"), tone: .error) }
            }
            if let error = model.eventsError, model.events.isEmpty {
                Section {
                    WarningRow(text: error, tone: .warning)
                    Button("Tekrar dene") { Task { await model.refreshEvents() } }
                }
            }
            Section {
                if mine.isEmpty && !model.eventsLoading {
                    Text("Henüz bir etkinliğe üye değilsin. Aşağıdan bir etkinliğe başvurabilirsin; organizatör onaylayınca burada rolünle görünür.")
                        .font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
                        .listRowBackground(Color.clear)
                }
                ForEach(mine) { e in row(e) }
            } header: {
                Text("Etkinliklerim")
            }
            if !others.isEmpty {
                Section {
                    ForEach(others) { e in row(e) }
                } header: {
                    Text("Keşfet ve başvur")
                }
            }
        }
        .listStyle(.plain)
        .aeroBackground()
        .navigationTitle("Etkinlikler")
        .searchable(text: $query, prompt: Text("Etkinlik veya yer ara"))
        .overlay { if model.eventsLoading && model.events.isEmpty { ProgressView() } }
        .refreshable { await model.refreshEvents() }
        .task { if model.events.isEmpty { await model.refreshEvents() } }
    }

    private func row(_ e: Event) -> some View {
        NavigationLink(value: EventRoute.event(e.id)) { EventRow(event: e) }
            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
            .accessibilityIdentifier("events.row.\(e.slug ?? e.id)")
    }
}
