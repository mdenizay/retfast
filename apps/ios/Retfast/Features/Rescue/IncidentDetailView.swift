import CoreLocation
import MapKit
import RetfastCore
import SwiftUI

struct IncidentDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State var incident: Incident
    @State private var route: [CLLocationCoordinate2D] = []
    @State private var team: [TeamMember] = []
    @State private var note = ""
    @State private var busy = false
    @State private var error: String?
    @State private var confirmResolve = false
    @State private var showAssign = false

    var body: some View {
        List {
            Section {
                HStack(spacing: AeroTokens.Space.s2) {
                    if incident.isTest ?? false { TestBadge() }
                    IncidentStatusPill(incident: incident)
                    Spacer()
                }
                if incident.isTest ?? false {
                    WarningRow(text: String(localized: "Bu bir TEST çağrısıdır, gerçek acil durum değildir."), tone: .warning)
                }
                KeyValueRow(key: String(localized: "Pilot"), value: incident.pilotName)
                if let msg = incident.message, !msg.isEmpty { KeyValueRow(key: String(localized: "Mesaj"), value: msg) }
                KeyValueRow(key: String(localized: "Cihazda oluşturuldu"), value: Fmt.dateTime(incident.createdAtDevice))
                KeyValueRow(key: String(localized: "Sunucuya ulaştı"), value: Fmt.dateTime(incident.receivedAt))
                KeyValueRow(key: String(localized: "Onaylandı"), value: incident.acknowledgedAt.map { "\(Fmt.dateTime($0)) · \(incident.acknowledgedBy?.fullName ?? "")" } ?? String(localized: "Henüz onaylanmadı"))
            }
            if let error { Section { WarningRow(text: error, tone: .error) } }

            Section("Aksiyonlar") { actions }

            Section("Konum") { positionSection }

            Section("İletişim") { contactSection }

            Section("Atamalar") {
                if (incident.assignments ?? []).isEmpty {
                    Text("Atama yok.").foregroundStyle(AeroTokens.textSecondary)
                }
                ForEach(incident.assignments ?? []) { a in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(a.responder?.fullName ?? Fmt.dash)
                            if let p = a.lastPosition {
                                Text("Son konum \(Fmt.relative(p.t))").font(.caption).foregroundStyle(AeroTokens.textSecondary)
                            }
                        }
                        Spacer()
                        AssignmentStatusPill(status: a.status)
                    }
                }
            }

            Section("Zaman çizelgesi") {
                let updates = (incident.updates ?? []).sorted { ($0.createdAt ?? .distantPast) > ($1.createdAt ?? .distantPast) }
                if updates.isEmpty { Text("Kayıt yok.").foregroundStyle(AeroTokens.textSecondary) }
                ForEach(updates) { u in
                    VStack(alignment: .leading, spacing: 2) {
                        Label(updateTitle(u), systemImage: updateIcon(u.kind)).font(.subheadline.weight(.semibold))
                        if let body = u.body, !body.isEmpty { Text(body).font(.subheadline) }
                        Text("\(u.actor?.fullName ?? String(localized: "Sistem")) · \(Fmt.dateTime(u.createdAt))")
                            .font(.caption).foregroundStyle(AeroTokens.textMuted)
                    }
                }
                HStack {
                    TextField("Not ekle", text: $note, axis: .vertical)
                    Button {
                        Task { await addNote() }
                    } label: { Image(systemName: "paperplane.fill") }
                        .disabled(note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy)
                        .accessibilityLabel(Text("Notu gönder"))
                }
            }
        }
        .navigationTitle(incident.pilotName)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await reload() }
        .task {
            await reload()
            await loadRoute()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 10_000_000_000)
                if Task.isCancelled { break }
                await reload()
            }
        }
        .confirmationDialog("Olay çözüldü olarak kapatılsın mı?", isPresented: $confirmResolve, titleVisibility: .visible) {
            Button("Çözüldü olarak işaretle", role: .destructive) { Task { await setStatus("resolved") } }
        } message: {
            Text("Pilot güvende ve müdahale tamamlandıysa kapatın. Bu işlem kaydedilir.")
        }
        .sheet(isPresented: $showAssign) {
            NavigationStack {
                List {
                    if let me = model.me {
                        Button { Task { await assign(me.id) } } label: { Label("Kendime ata", systemImage: "person.crop.circle.badge.checkmark") }
                    }
                    Section("Ekip") {
                        if team.isEmpty { Text("Ekip listesi boş veya yüklenemedi.").foregroundStyle(AeroTokens.textSecondary) }
                        ForEach(team) { m in
                            Button { Task { await assign(m.userId) } } label: {
                                HStack {
                                    Text(m.fullName ?? m.userId)
                                    Spacer()
                                    Text(m.availability == "available" ? String(localized: "Müsait") : String(localized: "Müsait değil"))
                                        .font(.caption).foregroundStyle(AeroTokens.textSecondary)
                                }
                            }
                        }
                    }
                }
                .navigationTitle("Atama yap")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Kapat") { showAssign = false } } }
                .task { team = (try? await model.api.rescueTeam()) ?? [] }
            }
            .presentationDetents([.medium, .large])
        }
    }

    @ViewBuilder private var actions: some View {
        if incident.acknowledgedAt == nil && incident.status == "open" {
            Button { Task { await acknowledge() } } label: { Label("Onayla", systemImage: "checkmark.shield") }
                .buttonStyle(.aeroPrimary)
                .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                .disabled(busy)
        }
        if incident.isActive && incident.status != "responding" {
            Button { Task { await setStatus("responding") } } label: { Label("Müdahale ediliyor", systemImage: "figure.run") }
                .disabled(busy)
        }
        if incident.isActive {
            Button { showAssign = true } label: { Label("Atama", systemImage: "person.badge.plus") }
                .disabled(busy)
            Button(role: .destructive) { confirmResolve = true } label: { Label("Çözüldü", systemImage: "checkmark.circle") }
                .disabled(busy)
        }
        if let c = incident.bestCoordinate, let url = AppleMaps.directionsURL(to: c, name: incident.pilotName) {
            Button { openURL(url) } label: { Label("Apple Haritalar'da yol tarifi", systemImage: "car.fill") }
        }
    }

    @ViewBuilder private var positionSection: some View {
        if let p = incident.position {
            KeyValueRow(key: String(localized: "SOS konumu"), value: Fmt.coordinate(p.lat, p.lon), mono: true)
            KeyValueRow(key: String(localized: "Doğruluk"), value: Fmt.accuracy(p.hAccM))
            let alt = Fmt.altitude(p.gpsAltM)
            KeyValueRow(key: String(localized: "GPS irtifa"), value: "\(alt.0) \(alt.1)")
            KeyValueRow(key: String(localized: "GPS zamanı"), value: Fmt.dateTime(p.t))
        } else {
            WarningRow(text: String(localized: "SOS konum içermiyor."), tone: .warning)
        }
        if let l = incident.lastKnownPosition {
            KeyValueRow(key: String(localized: "Son bilinen konum"), value: Fmt.coordinate(l.lat, l.lon), mono: true)
            KeyValueRow(key: String(localized: "Doğruluk"), value: Fmt.accuracy(l.hAccM))
            HStack {
                Text("Son konum zamanı").foregroundStyle(AeroTokens.textSecondary)
                Spacer()
                FreshnessBadge(freshness: nil, age: Date().timeIntervalSince(l.receivedAt ?? l.t))
            }
        }
        if let c = incident.bestCoordinate {
            Map(initialPosition: .region(MKCoordinateRegion(center: c, latitudinalMeters: 4000, longitudinalMeters: 4000))) {
                if route.count > 1 {
                    MapPolyline(coordinates: route).stroke(AeroTokens.secondary, lineWidth: 3)
                }
                if let p = incident.position {
                    let pc = CLLocationCoordinate2D(latitude: p.lat, longitude: p.lon)
                    if let acc = p.hAccM, acc > 0 {
                        MapCircle(center: pc, radius: acc).foregroundStyle(AeroTokens.emergency.opacity(0.15))
                    }
                    Marker("SOS", systemImage: "sos", coordinate: pc).tint(AeroTokens.emergency)
                }
                if let l = incident.lastKnownPosition {
                    Marker(String(localized: "Son konum"), systemImage: "location", coordinate: CLLocationCoordinate2D(latitude: l.lat, longitude: l.lon))
                        .tint(AeroTokens.secondary)
                }
            }
            .frame(height: 240)
            .clipShape(RoundedRectangle(cornerRadius: AeroTokens.Radius.md))
            .listRowInsets(EdgeInsets())
        }
    }

    @ViewBuilder private var contactSection: some View {
        let pilot = incident.pilot
        if let name = pilot?.emergencyContactName, !name.isEmpty {
            KeyValueRow(key: String(localized: "Acil durum kişisi"), value: name)
        }
        if let phone = pilot?.emergencyContactPhone, !phone.isEmpty,
           let url = URL(string: "tel:\(phone.filter { "+0123456789".contains($0) })") {
            Link(destination: url) { Label(phone, systemImage: "phone.fill") }
        }
        if let blood = pilot?.bloodType, !blood.isEmpty {
            KeyValueRow(key: String(localized: "Kan grubu"), value: blood)
        }
        if (pilot?.emergencyContactName ?? "").isEmpty && (pilot?.emergencyContactPhone ?? "").isEmpty {
            Text("İletişim bilgisi yok veya bu bilgiyi görme yetkiniz yok.").font(.subheadline).foregroundStyle(AeroTokens.textSecondary)
        }
    }

    private func updateTitle(_ u: IncidentUpdate) -> String {
        switch u.kind {
        case "created": String(localized: "SOS oluşturuldu")
        case "acknowledged": String(localized: "Onaylandı")
        case "status_changed": String(localized: "Durum: \(u.status ?? "")")
        case "note": String(localized: "Not")
        case "assigned": String(localized: "Atama")
        case "assignment_status": String(localized: "Atama durumu: \(u.status ?? "")")
        case "position": String(localized: "Konum güncellendi")
        default: u.kind
        }
    }

    private func updateIcon(_ kind: String) -> String {
        switch kind {
        case "created": "sos"
        case "acknowledged": "checkmark.shield"
        case "status_changed": "arrow.triangle.swap"
        case "note": "note.text"
        case "assigned", "assignment_status": "person.badge.plus"
        case "position": "location"
        default: "circle"
        }
    }

    // MARK: Actions

    private func reload() async {
        do {
            incident = try await model.api.incident(incident.id)
            error = nil
        } catch {
            self.error = RescueText.message(error)
        }
    }

    private func loadRoute() async {
        guard let fid = incident.flightId,
              let page = try? await model.api.positions(flightId: fid, simplify: true) else { return }
        route = page.items.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }
    }

    private func perform(_ action: () async throws -> Void) async {
        busy = true; defer { busy = false }
        do {
            try await action()
            error = nil
            await reload()
        } catch {
            self.error = RescueText.message(error)
        }
    }

    private func acknowledge() async {
        let id = incident.id
        await perform { try await model.api.acknowledgeIncident(id) }
    }

    private func setStatus(_ status: String) async {
        let id = incident.id
        await perform { try await model.api.setIncidentStatus(id, status: status, note: nil) }
    }

    private func addNote() async {
        let id = incident.id, body = note.trimmingCharacters(in: .whitespacesAndNewlines)
        await perform { try await model.api.addIncidentNote(id, body: body) }
        if error == nil { note = "" }
    }

    private func assign(_ userId: String) async {
        let id = incident.id
        showAssign = false
        await perform { try await model.api.assignIncident(id, responderUserId: userId) }
    }
}
