import RetfastCore
import SwiftUI

struct ProfileView: View {
    @Environment(AppModel.self) private var model
    @AppStorage("units") private var units = Units.metric.rawValue
    @AppStorage("appearance") private var appearance = AppAppearance.system.rawValue
    @AppStorage("fcTheme") private var fcTheme = FlightComputerTheme.auto.rawValue
    @State private var exportURL: URL?
    @State private var exportError: String?
    @State private var exporting = false
    @State private var confirmDelete = false
    @State private var deletion: DeletionRequestStatus?
    @State private var message: String?
    @State private var confirmLogout = false

    var body: some View {
        Form {
            if let me = model.me {
                Section {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(me.pilot?.displayName ?? me.fullName).font(.title3.bold())
                        Text(me.email).foregroundStyle(AeroTokens.textSecondary)
                        if let id = me.pilot?.publicId { Text("@\(id)").font(.caption.monospaced()).foregroundStyle(AeroTokens.textMuted) }
                    }
                    HStack { ForEach(me.roles, id: \.self) { StatusPill($0, systemImage: "person.badge.key", tone: .info) } }
                    if me.emailVerified == false {
                        WarningRow(text: String(localized: "E-posta adresiniz doğrulanmadı."))
                    }
                }
                Section("Pilot") {
                    NavigationLink("Pilot bilgileri ve acil durum kişisi") { PilotProfileEditor() }
                    if (me.pilot?.emergencyContactPhone ?? "").isEmpty {
                        WarningRow(text: String(localized: "Acil durum kişisi eklenmemiş. Kurtarma ekibi size ulaşacak kişiyi bilemez."))
                    }
                }
                Section("Gizlilik") {
                    NavigationLink("Gizlilik ve varsayılan görünürlük") { PrivacyEditor() }
                }
            }
            Section("Görünüm") {
                Picker("Birimler", selection: $units) {
                    Text("Metrik (m, km/h)").tag(Units.metric.rawValue)
                    Text("Imperial (ft, mph)").tag(Units.imperial.rawValue)
                }
                Picker("Uygulama görünümü", selection: $appearance) {
                    ForEach(AppAppearance.allCases) { Text($0.title).tag($0.rawValue) }
                }
                Picker("Uçuş bilgisayarı teması", selection: $fcTheme) {
                    ForEach(FlightComputerTheme.allCases) { Text($0.title).tag($0.rawValue) }
                }
            }
            Section("Verilerim") {
                Button {
                    Task { await export() }
                } label: { if exporting { ProgressView() } else { Label("Verilerimi dışa aktar (JSON)", systemImage: "square.and.arrow.down") } }
                if let exportURL { ShareLink(item: exportURL) { Label("Dışa aktarılan dosyayı paylaş", systemImage: "square.and.arrow.up") } }
                if let exportError { WarningRow(text: exportError, tone: .error) }
            }
            Section("Uygulama") {
                NavigationLink { DiagnosticsView() } label: { Label("Tanılama", systemImage: "stethoscope") }
                NavigationLink { SOSHistoryView() } label: { Label("Acil durum geçmişi", systemImage: "sos") }
                NavigationLink { ChangePasswordView(forced: false) } label: { Label("Şifre değiştir", systemImage: "key") }
                Button { model.onboardingCompleted = false } label: { Label("Tanıtımı yeniden göster", systemImage: "info.circle") }
                KeyValueRow(key: String(localized: "Sürüm"), value: "\(model.config.appVersion) (\(model.config.build))")
            }
            Section {
                if let deletion {
                    WarningRow(text: String(localized: "Hesap silme talebi alındı (\(Fmt.dateTime(deletion.requestedAt))). Hesap 14 gün sonra kapatılır."))
                    Button("Silme talebini geri al") {
                        Task {
                            do { try await model.api.cancelDeletion(); self.deletion = nil; message = String(localized: "Silme talebi geri alındı.") }
                            catch { message = ErrorText.message(error) }
                        }
                    }
                } else {
                    Button("Hesabımı sil", role: .destructive) { confirmDelete = true }
                }
                if let message { Text(message).font(.footnote) }
                Button("Çıkış yap", role: .destructive) { confirmLogout = true }
                    .disabled(model.session.isActive)
                if model.session.isActive {
                    Text("Uçuş kaydı sürerken çıkış yapılamaz.").font(.footnote).foregroundStyle(AeroTokens.textSecondary)
                }
            } header: { Text("Hesap") }
        }
        .navigationTitle("Profil")
        .confirmationDialog("Hesabınız silinsin mi?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Silme talebi gönder", role: .destructive) {
                Task {
                    do { deletion = try await model.api.requestDeletion(reason: nil) }
                    catch { message = ErrorText.message(error) }
                }
            }
        } message: {
            Text("Hesabınız 14 gün sonra kapatılır; bu süre içinde talebi geri alabilirsiniz. Önce verilerinizi dışa aktarmanız önerilir.")
        }
        .confirmationDialog("Çıkış yapılsın mı?", isPresented: $confirmLogout, titleVisibility: .visible) {
            Button("Çıkış yap", role: .destructive) { Task { await model.logout() } }
        } message: {
            Text("Gönderilmemiş uçuş noktaları cihazda kalır ve tekrar giriş yaptığınızda gönderilir.")
        }
    }

    private func export() async {
        exporting = true; defer { exporting = false }
        do {
            let data = try await model.api.exportData()
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("retfast-export.json")
            try data.write(to: url)
            exportURL = url
            exportError = nil
        } catch {
            exportError = ErrorText.message(error)
        }
    }
}

struct PilotProfileEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var fullName = ""
    @State private var p = PilotProfile()
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        Form {
            Section("Kişisel") {
                TextField("Ad Soyad", text: $fullName)
                TextField("Görünen ad", text: bind(\.displayName))
                TextField("Uyruk (ör. TR)", text: bind(\.nationality)).textInputAutocapitalization(.characters)
                TextField("Hakkımda", text: bind(\.bio), axis: .vertical)
            }
            Section("Uçuş") {
                TextField("Kanat", text: bind(\.wing))
                TextField("Lisans no", text: bind(\.licenseNo))
            }
            Section {
                TextField("Acil durum kişisi", text: bind(\.emergencyContactName)).textContentType(.name)
                TextField("Acil durum telefonu", text: bind(\.emergencyContactPhone)).keyboardType(.phonePad).textContentType(.telephoneNumber)
                TextField("Kan grubu", text: bind(\.bloodType))
            } header: { Text("Acil durum") } footer: {
                Text("Bu bilgiler yalnızca acil durum çağrısı açtığınızda yetkili kurtarma ekibine gösterilir; herkese açık profilde asla görünmez.")
            }
            if let error { Section { WarningRow(text: error, tone: .error) } }
            Section {
                Button { Task { await save() } } label: { if saving { ProgressView() } else { Text("Kaydet") } }
                    .buttonStyle(.aeroPrimary).listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
            }
        }
        .navigationTitle("Pilot bilgileri")
        .onAppear {
            fullName = model.me?.fullName ?? ""
            p = model.me?.pilot ?? PilotProfile()
        }
    }

    private func bind(_ key: WritableKeyPath<PilotProfile, String?>) -> Binding<String> {
        Binding(get: { p[keyPath: key] ?? "" }, set: { p[keyPath: key] = $0 })
    }

    private func save() async {
        saving = true; defer { saving = false }
        do {
            if fullName != model.me?.fullName { _ = try await model.api.updateMe(fullName: fullName, preferences: nil) }
            _ = try await model.api.updatePilot(p)
            model.didSignIn(try await model.api.me())
            dismiss()
        } catch {
            self.error = ErrorText.message(error)
        }
    }
}

struct PrivacyEditor: View {
    @Environment(AppModel.self) private var model
    @State private var publicProfile = false
    @State private var visibility = "event"
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                Toggle("Herkese açık pilot profili", isOn: $publicProfile)
            } footer: {
                Text("Açıkken adınız, kanadınız ve herkese açık uçuşlarınız profil sayfanızda görünür. İletişim, lisans ve acil durum bilgileri asla gösterilmez.")
            }
            Section {
                Picker("Varsayılan uçuş görünürlüğü", selection: $visibility) {
                    Text("Yalnızca ben").tag("private")
                    Text("Etkinlik katılımcıları").tag("event")
                    Text("Herkese açık").tag("public")
                }
            } footer: {
                Text("Her uçuştan önce değiştirebilirsiniz. Acil durum çağrısında yetkili kurtarma ekibi görünürlükten bağımsız olarak konumunuzu görür.")
            }
            if let error { Section { WarningRow(text: error, tone: .error) } }
            Section {
                Button("Kaydet") {
                    Task {
                        do {
                            let me = try await model.api.updateMe(fullName: nil, preferences: Preferences(units: Units.current.rawValue, defaultFlightVisibility: visibility, publicProfile: publicProfile))
                            model.didSignIn(me)
                            error = nil
                        } catch { self.error = ErrorText.message(error) }
                    }
                }
            }
        }
        .navigationTitle("Gizlilik")
        .onAppear {
            publicProfile = model.me?.preferences?.publicProfile ?? false
            visibility = model.me?.preferences?.defaultFlightVisibility ?? "event"
        }
    }
}
