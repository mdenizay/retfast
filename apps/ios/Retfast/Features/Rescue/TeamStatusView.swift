import RetfastCore
import SwiftUI

struct TeamStatusView: View {
    @Environment(AppModel.self) private var model
    @State private var team: [TeamMember] = []
    @State private var assignments: [Assignment] = []
    @State private var error: String?
    @State private var busy = false

    private var me: TeamMember? { team.first { $0.userId == model.me?.id } }

    var body: some View {
        List {
            if let error { Section { WarningRow(text: error, tone: .error) } }

            if model.me?.roles.contains("rescue_operator") ?? false {
                Section {
                    Toggle(isOn: Binding(
                        get: { me?.availability == "available" },
                        set: { on in Task { await setAvailability(on ? "available" : "unavailable") } })) {
                        Label(me?.availability == "available" ? "Müsaitim" : "Müsait değilim",
                              systemImage: me?.availability == "available" ? "checkmark.circle.fill" : "moon.circle")
                    }
                    .disabled(busy)
                } header: { Text("Durumum") } footer: {
                    Text("Müsait olduğunuzda koordinatörler size olay atayabilir.")
                }
            }

            Section("Görevlerim") {
                if assignments.isEmpty { Text("Aktif görev yok.").foregroundStyle(AeroTokens.textSecondary) }
                ForEach(assignments) { a in
                    VStack(alignment: .leading, spacing: AeroTokens.Space.s2) {
                        HStack {
                            Text("Olay \(String((a.incidentId ?? a.id).prefix(8)))").font(.subheadline.monospaced())
                            Spacer()
                            AssignmentStatusPill(status: a.status)
                        }
                        if let next = AssignmentStatus(rawValue: a.status)?.next {
                            Button {
                                Task { await advance(a, to: next) }
                            } label: {
                                Label("İlerlet: \(next.title)", systemImage: next.systemImage)
                            }
                            .buttonStyle(.aeroSecondary)
                            .disabled(busy)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }

            Section("Ekip") {
                if team.isEmpty { Text("Ekip bilgisi yok.").foregroundStyle(AeroTokens.textSecondary) }
                ForEach(team) { m in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(m.fullName ?? m.userId).font(.headline)
                            Spacer()
                            if m.availability == "available" {
                                StatusPill(String(localized: "Müsait"), systemImage: "checkmark.circle", tone: .success)
                            } else {
                                StatusPill(String(localized: "Müsait değil"), systemImage: "moon", tone: .neutral)
                            }
                        }
                        HStack {
                            if let a = m.activeAssignment { AssignmentStatusPill(status: a.status) }
                            if let p = m.lastPosition, let t = p.t {
                                FreshnessBadge(freshness: nil, age: Date().timeIntervalSince(t))
                            } else {
                                StatusPill(String(localized: "Konum yok"), systemImage: "location.slash", tone: .neutral)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Ekip durumu")
        .refreshable { await load() }
        .task { await load() }
    }

    private func load() async {
        do {
            team = try await model.api.rescueTeam()
            error = nil
        } catch {
            self.error = RescueText.message(error)
        }
        if let mine = try? await model.api.myAssignments() {
            assignments = mine.filter { $0.status != "completed" && $0.status != "withdrawn" }
        }
    }

    private func setAvailability(_ value: String) async {
        busy = true; defer { busy = false }
        do { try await model.api.setAvailability(value); await load() }
        catch { self.error = RescueText.message(error) }
    }

    private func advance(_ a: Assignment, to next: AssignmentStatus) async {
        busy = true; defer { busy = false }
        do { try await model.api.setAssignmentStatus(a.id, status: next.rawValue); await load() }
        catch { self.error = RescueText.message(error) }
    }
}
