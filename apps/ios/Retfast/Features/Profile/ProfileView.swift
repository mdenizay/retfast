import RetfastCore
import SwiftUI

struct ProfileView: View {
    @Environment(AppModel.self) private var model
    @AppStorage("units") private var units = Units.metric.rawValue
    @AppStorage("appearance") private var appearance = AppAppearance.system.rawValue
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
                    if me.isPlatformAdmin { StatusPill(String(localized: "Platform yöneticisi"), systemImage: "person.badge.key", tone: .info) }
                    if me.emailVerified == false {
                        WarningRow(text: String(localized: "E-posta adresiniz doğrulanmadı."))
                    }
                }
                Section {
                    NavigationLink("Pilot bilgileri, telefon ve acil durum kişisi") { PilotProfileEditor() }
                        .accessibilityIdentifier("profile.pilot")
                    if (me.pilot?.phone ?? "").isEmpty {
                        WarningRow(text: String(localized: "Telefon numarası eklenmemiş. Retrieve istediğinde retriever seni arayamaz."))
                    }
                } header: { Text("Pilot") } footer: {
                    Text("Telefonunu yalnızca etkinlik organizatörleri ve retrieve talebini kabul eden retriever görür.")
                }
                Section("Gizlilik") {
                    NavigationLink("Herkese açık profil") { PrivacyEditor() }
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
                // iOS per-app language (Türkçe / English) lives in Settings › Retfast › Language.
                Button {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                } label: {
                    HStack {
                        Label("Dil / Language", icon: "globe").foregroundStyle(AeroTokens.textPrimary)
                        Spacer()
                        Text(Bundle.main.preferredLocalizations.first == "en" ? "English" : "Türkçe")
                            .foregroundStyle(AeroTokens.textSecondary)
                        Image(icon: "arrow.up.right").font(.caption).foregroundStyle(AeroTokens.textMuted)
                    }
                }
                .accessibilityIdentifier("profile.language")
            }
            Section("Verilerim") {
                Button {
                    Task { await export() }
                } label: { if exporting { ProgressView() } else { Label("Verilerimi dışa aktar (JSON)", icon: "square.and.arrow.down") } }
                if let exportURL { ShareLink(item: exportURL) { Label("Dışa aktarılan dosyayı paylaş", icon: "square.and.arrow.up") } }
                if let exportError { WarningRow(text: exportError, tone: .error) }
            }
            Section("Uygulama") {
                NavigationLink { DiagnosticsView() } label: { Label("Tanılama", icon: "stethoscope") }
                NavigationLink { ChangePasswordView(forced: false) } label: { Label("Şifre değiştir", icon: "key") }
                Button { model.onboardingCompleted = false } label: { Label("Tanıtımı yeniden göster", icon: "info.circle") }
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
                    .disabled(model.session.isActive || model.activeRetrieval != nil)
                if model.session.isActive || model.activeRetrieval != nil {
                    Text("Uçuş kaydı veya açık retrieve talebi sürerken çıkış yapılamaz.").font(.footnote).foregroundStyle(AeroTokens.textSecondary)
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
            Text("Gönderilmemiş uçuş noktaları cihazda kalır ve tekrar giriş yaptığınızda gönderilir. Retriever görevin kapatılır.")
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
                TextField("Telefon (ör. +90 5xx xxx xx xx)", text: bind(\.phone)).keyboardType(.phonePad).textContentType(.telephoneNumber)
                    .accessibilityIdentifier("profile.phone")
            } header: { Text("Telefon") } footer: {
                Text("Yalnızca etkinlik organizatörleri ve retrieve talebini kabul eden retriever görür (seni alırken arayabilmesi için). Herkese açık profilde asla görünmez.")
            }
            Section {
                TextField("Acil durum kişisi", text: bind(\.emergencyContactName)).textContentType(.name)
                TextField("Acil durum kişisinin telefonu", text: bind(\.emergencyContactPhone)).keyboardType(.phonePad).textContentType(.telephoneNumber)
            } header: { Text("Acil durum kişisi") } footer: {
                Text("Organizatörler gerektiğinde ulaşabilsin diye. Retfast acil durum servisi değildir; acil durumda 112'yi ara.")
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
    @State private var error: String?
    @State private var saved = false

    var body: some View {
        Form {
            Section {
                Toggle("Herkese açık pilot profili", isOn: $publicProfile)
            } footer: {
                Text("Açıkken adın ve kanadın profil sayfanda görünür. Telefon, lisans ve acil durum bilgileri asla gösterilmez. Etkinlik uçuşları rol kurallarına göre paylaşılır; etkinlik dışı uçuşlar yalnızca sana aittir.")
            }
            if let error { Section { WarningRow(text: error, tone: .error) } }
            if saved { Section { WarningRow(text: String(localized: "Kaydedildi."), tone: .success, systemImage: "checkmark.circle") } }
            Section {
                Button("Kaydet") {
                    Task {
                        do {
                            let me = try await model.api.updateMe(fullName: nil, preferences: Preferences(units: Units.current.rawValue, publicProfile: publicProfile))
                            model.didSignIn(me)
                            error = nil
                            saved = true
                        } catch { self.error = ErrorText.message(error) }
                    }
                }
            }
        }
        .navigationTitle("Gizlilik")
        .onAppear { publicProfile = model.me?.preferences?.publicProfile ?? false }
    }
}
