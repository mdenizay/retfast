import RetfastCore
import SwiftUI

struct AuthFlowView: View {
    var body: some View {
        NavigationStack { LoginView() }
    }
}

/// Maps contract errors to user text. Never shows raw server internals.
enum ErrorText {
    static func message(_ error: any Error) -> String {
        guard let api = error as? APIError else { return String(localized: "Beklenmeyen bir hata oluştu.") }
        switch api {
        case .transport(_, true): return String(localized: "İnternet bağlantısı yok veya sunucuya ulaşılamıyor.")
        case .transport: return String(localized: "Sunucuya bağlanılamadı.")
        case .notAuthenticated: return String(localized: "Oturum açmanız gerekiyor.")
        case .decoding: return String(localized: "Sunucu yanıtı anlaşılamadı. Uygulamayı güncellemeniz gerekebilir.")
        case .server(let status, let code, let message, let details, let retryAfter):
            switch code {
            case "unauthorized" where status == 401: return String(localized: "E-posta veya şifre hatalı.")
            case "rate_limited":
                return String(localized: "Çok fazla deneme. \(Int(retryAfter ?? 60)) saniye sonra tekrar deneyin.")
            case "validation_failed":
                if let detail = details?.values.first { return detail }
                return message ?? String(localized: "Girilen bilgiler geçersiz.")
            case "conflict": return message ?? String(localized: "Bu kayıt zaten var.")
            case "forbidden": return String(localized: "Bu işlem için yetkiniz yok.")
            case "not_found": return String(localized: "Bulunamadı.")
            case "password_change_required": return String(localized: "Devam etmek için şifrenizi değiştirmeniz gerekiyor.")
            default: return message ?? String(localized: "Sunucu hatası (\(status)).")
            }
        }
    }
}

struct LoginView: View {
    @Environment(AppModel.self) private var model
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AeroTokens.Space.s6) {
                VStack(alignment: .leading, spacing: AeroTokens.Space.s3) {
                    BrandMark(size: 64, color: Brand.orange)
                    Text("Retfast").font(.system(size: 40, weight: .bold))
                    Text("Uçuşunu kaydet, iniş yerini paylaş, retriever seni alsın.")
                        .font(.title3).foregroundStyle(AeroTokens.textSecondary)
                }
                .padding(.top, AeroTokens.Space.s8)

                if let message = model.authMessage { WarningRow(text: message) }

                VStack(spacing: AeroTokens.Space.s3) {
                    field { TextField("E-posta", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("login.email") }
                    field { SecureField("Şifre", text: $password)
                        .textContentType(.password)
                        .accessibilityIdentifier("login.password") }
                    if let error { WarningRow(text: error, tone: .error) }
                    Button {
                        Task { await login() }
                    } label: {
                        if busy { ProgressView().tint(.white) } else { Text("Giriş yap") }
                    }
                    .buttonStyle(.aeroPrimaryLarge)
                    .disabled(busy || email.isEmpty || password.isEmpty)
                    .accessibilityIdentifier("login.submit")
                }

                HStack {
                    NavigationLink("Hesap oluştur") { RegisterView() }.fontWeight(.semibold)
                    Spacer()
                    NavigationLink("Şifremi unuttum") { ForgotPasswordView() }
                }
                .tint(AeroTokens.textPrimary)

                Text("Sunucu: \(model.config.apiBaseURL.absoluteString)")
                    .font(.caption2.monospaced())
                    .foregroundStyle(AeroTokens.textMuted)
            }
            .padding(.horizontal, AeroTokens.Space.s6)
            .padding(.bottom, AeroTokens.Space.s8)
        }
        .scrollDismissesKeyboard(.interactively)
        .aeroBackground()
        .toolbar(.hidden, for: .navigationBar)
    }

    private func field<C: View>(@ViewBuilder _ c: () -> C) -> some View {
        c()
            .font(.body)
            .padding(.horizontal, AeroTokens.Space.s4)
            .frame(height: AeroTokens.Control.heightLarge)
            .background(AeroTokens.surface, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.md, style: .continuous))
    }

    private func login() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            let me = try await model.api.login(email: email.trimmingCharacters(in: .whitespaces), password: password)
            password = ""
            if me.mustChangePassword {
                model.me = me
                model.authPhase = .mustChangePassword
            } else {
                model.didSignIn(me)
            }
        } catch {
            self.error = ErrorText.message(error)
        }
    }
}

struct RegisterView: View {
    @Environment(AppModel.self) private var model
    @State private var fullName = ""
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                TextField("Ad Soyad", text: $fullName).textContentType(.name)
                TextField("E-posta", text: $email)
                    .textContentType(.emailAddress).keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField("Şifre", text: $password).textContentType(.newPassword)
            } footer: {
                PasswordPolicyHint(password: password, email: email)
            }
            if let error { Section { WarningRow(text: error, tone: .error) } }
            Section {
                Button {
                    Task {
                        busy = true; defer { busy = false }
                        do { model.didSignIn(try await model.api.register(email: email, password: password, fullName: fullName)) }
                        catch { self.error = ErrorText.message(error) }
                    }
                } label: { if busy { ProgressView() } else { Text("Hesap oluştur") } }
                .buttonStyle(.aeroPrimary)
                .disabled(busy || fullName.isEmpty || email.isEmpty || password.count < 10)
                .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
            }
        }
        .navigationTitle("Hesap oluştur")
    }
}

struct PasswordPolicyHint: View {
    let password: String
    var email: String = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            rule("En az 10 karakter", ok: password.count >= 10)
            rule("E-posta adresinizle aynı olamaz", ok: !password.isEmpty && password.lowercased() != email.lowercased())
        }
        .font(.caption)
    }
    private func rule(_ text: LocalizedStringKey, ok: Bool) -> some View {
        Label { Text(text) } icon: { Image(icon: ok ? "checkmark.circle.fill" : "circle") }
            .foregroundStyle(ok ? AeroTokens.success : AeroTokens.textSecondary)
    }
}

struct ForgotPasswordView: View {
    @Environment(AppModel.self) private var model
    @State private var email = ""
    @State private var sent = false
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                TextField("E-posta", text: $email)
                    .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
            } footer: {
                Text("Hesap varsa bu adrese bir sıfırlama bağlantısı gönderilir. Güvenlik nedeniyle hesabın var olup olmadığını göstermiyoruz.")
            }
            if sent { Section { WarningRow(text: String(localized: "İstek alındı. E-postanızı kontrol edin."), tone: .success, systemImage: "checkmark.circle.fill") } }
            if let error { Section { WarningRow(text: error, tone: .error) } }
            Section {
                Button("Sıfırlama bağlantısı gönder") {
                    Task {
                        do { try await model.api.forgotPassword(email: email); sent = true; error = nil }
                        catch { self.error = ErrorText.message(error) }
                    }
                }
                .buttonStyle(.aeroPrimary)
                .disabled(email.isEmpty)
                .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
            }
        }
        .navigationTitle("Şifremi unuttum")
    }
}

/// When `forced`, the rest of the app is blocked until the password is changed
/// (server returns 403 password_change_required for everything else anyway).
struct ChangePasswordView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let forced: Bool
    @State private var current = ""
    @State private var new = ""
    @State private var confirm = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Form {
            if forced {
                Section {
                    WarningRow(text: String(localized: "Güvenliğiniz için ilk girişte şifrenizi değiştirmeniz gerekiyor. Bu adımı tamamlamadan uygulamayı kullanamazsınız."), tone: .warning, systemImage: "lock.rotation")
                }
            }
            Section {
                SecureField("Mevcut şifre", text: $current).textContentType(.password)
                    .accessibilityIdentifier("password.current")
                SecureField("Yeni şifre", text: $new).textContentType(.newPassword)
                    .accessibilityIdentifier("password.new")
                SecureField("Yeni şifre (tekrar)", text: $confirm).textContentType(.newPassword)
                    .accessibilityIdentifier("password.confirm")
            } footer: {
                VStack(alignment: .leading) {
                    PasswordPolicyHint(password: new, email: model.me?.email ?? "")
                    Label { Text("Mevcut şifreden farklı olmalı") } icon: { Image(icon: !new.isEmpty && new != current ? "checkmark.circle.fill" : "circle") }
                        .font(.caption)
                    Label { Text("Tekrar ile eşleşmeli") } icon: { Image(icon: !new.isEmpty && new == confirm ? "checkmark.circle.fill" : "circle") }
                        .font(.caption)
                }
            }
            if let error { Section { WarningRow(text: error, tone: .error) } }
            Section {
                Button {
                    Task { await submit() }
                } label: { if busy { ProgressView() } else { Text("Şifreyi değiştir") } }
                .buttonStyle(.aeroPrimary)
                .disabled(busy || new.count < 10 || new != confirm || new == current || current.isEmpty)
                .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                .accessibilityIdentifier("password.submit")
            }
            if forced {
                Section {
                    Button("Çıkış yap", role: .destructive) { Task { await model.logout() } }
                }
            }
        }
        .navigationTitle(forced ? "Yeni şifre belirleyin" : "Şifre değiştir")
        .interactiveDismissDisabled(forced)
    }

    private func submit() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            let me = try await model.api.changePassword(current: current, new: new)
            model.didSignIn(me)
            if !forced { dismiss() }
        } catch {
            self.error = ErrorText.message(error)
        }
    }
}
