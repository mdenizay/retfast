import RetfastCore
import SwiftUI

struct AuthFlowView: View {
    var body: some View {
        NavigationStack { AuthWelcomeView() }
            .environment(\.colorScheme, .dark)
            .tint(.white)
    }
}

/// First screen when signed out: hero, Apple / Google, "Continue with email".
struct AuthWelcomeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var comingSoon: String?
    @State private var appear = false

    var body: some View {
        ZStack {
            SkyBackdrop(glowCenter: UnitPoint(x: 0.5, y: 0.32))
            VStack(spacing: 0) {
                Spacer(minLength: AeroTokens.Space.s8)
                VStack(spacing: AeroTokens.Space.s4) {
                    BrandMark(size: 44, color: Brand.ink)
                        .frame(width: 84, height: 84)
                        .background(Brand.accent, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
                    Text("Retfast")
                        .font(.system(size: 36, weight: .semibold))
                        .foregroundStyle(.white)
                    Text("Uç. İn. Alın.")
                        .font(.title3.weight(.medium))
                        .foregroundStyle(.white.opacity(0.65))
                }
                .scaleEffect(appear ? 1 : 0.92)
                .opacity(appear ? 1 : 0)
                Spacer(minLength: AeroTokens.Space.s8)

                VStack(spacing: AeroTokens.Space.s3) {
                    if let message = model.authMessage {
                        Text(message).font(.footnote).foregroundStyle(Brand.accentLight)
                            .multilineTextAlignment(.center).padding(.bottom, AeroTokens.Space.s2)
                    }
                    Button { comingSoon = "Apple" } label: {
                        Label { Text("Apple ile devam et") } icon: { Image(systemName: "apple.logo") }
                    }
                    .buttonStyle(WhiteCapsuleButtonStyle())
                    .accessibilityIdentifier("auth.apple")
                    Button { comingSoon = "Google" } label: {
                        Label { Text("Google ile devam et") } icon: { GoogleGlyph(size: 18) }
                    }
                    .buttonStyle(WhiteCapsuleButtonStyle())
                    .accessibilityIdentifier("auth.google")
                    NavigationLink { EmailLoginView() } label: {
                        Label("E-posta ile devam et", icon: "envelope")
                    }
                    .buttonStyle(GlassCapsuleButtonStyle())
                    .accessibilityIdentifier("auth.email")
                }
                .offset(y: appear ? 0 : 30)
                .opacity(appear ? 1 : 0)

                HStack(spacing: AeroTokens.Space.s4) {
                    Button("Gizlilik") { if let u = URL(string: "https://retfast.com/privacy") { openURL(u) } }
                    Text("·").foregroundStyle(.white.opacity(0.3))
                    NavigationLink("Hesap oluştur") { RegisterView() }
                        .accessibilityIdentifier("auth.register")
                }
                .font(.footnote.weight(.medium))
                .foregroundStyle(.white.opacity(0.55))
                .padding(.top, AeroTokens.Space.s6)
            }
            .padding(.horizontal, AeroTokens.Space.s6)
            .padding(.bottom, AeroTokens.Space.s4)
            .frame(maxWidth: 520)
        }
        .toolbar(.hidden, for: .navigationBar)
        .onAppear { withAnimation(.spring(response: 0.7, dampingFraction: 0.8)) { appear = true } }
        .alert(Text("\(comingSoon ?? "") ile giriş yakında"), isPresented: Binding(get: { comingSoon != nil }, set: { if !$0 { comingSoon = nil } })) {
            Button("Tamam", role: .cancel) {}
        } message: {
            Text("Şimdilik e-posta ile devam edebilirsin.")
        }
    }
}

/// Dark scaffold shared by the e-mail, register and reset screens.
struct AuthScaffold<Content: View>: View {
    let title: LocalizedStringKey
    let subtitle: LocalizedStringKey?
    @ViewBuilder var content: Content

    var body: some View {
        ZStack(alignment: .top) {
            Brand.ink.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: AeroTokens.Space.s6) {
                    VStack(alignment: .leading, spacing: AeroTokens.Space.s2) {
                        Text(title).font(.system(size: 30, weight: .semibold)).foregroundStyle(.white)
                        if let subtitle { Text(subtitle).font(.body).foregroundStyle(.white.opacity(0.6)) }
                    }
                    content
                }
                .padding(.horizontal, AeroTokens.Space.s6)
                .padding(.top, AeroTokens.Space.s4)
                .padding(.bottom, AeroTokens.Space.s8)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .toolbarBackground(.hidden, for: .navigationBar)
        .navigationBarTitleDisplayMode(.inline)
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

struct EmailLoginView: View {
    @Environment(AppModel.self) private var model
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?
    private enum Field { case email, password }

    var body: some View {
        AuthScaffold(title: "Tekrar hoş geldin", subtitle: "E-posta adresin ve şifrenle giriş yap.") {
            VStack(spacing: AeroTokens.Space.s3) {
                AuthField(icon: "envelope") {
                    TextField("", text: $email, prompt: Text("E-posta").foregroundStyle(.white.opacity(0.4)))
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.next)
                        .focused($focus, equals: .email)
                        .onSubmit { focus = .password }
                        .accessibilityIdentifier("login.email")
                }
                AuthField(icon: "lock") {
                    SecureField("", text: $password, prompt: Text("Şifre").foregroundStyle(.white.opacity(0.4)))
                        .textContentType(.password)
                        .submitLabel(.go)
                        .focused($focus, equals: .password)
                        .onSubmit { if canSubmit { Task { await login() } } }
                        .accessibilityIdentifier("login.password")
                }
                HStack {
                    Spacer()
                    NavigationLink("Şifremi unuttum") { ForgotPasswordView() }
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.6))
                }
            }
            if let error {
                Label(error, icon: "exclamationmark.circle").font(.subheadline).foregroundStyle(AeroTokens.error)
                    .transition(.opacity)
            }
            Button {
                Task { await login() }
            } label: {
                if busy { ProgressView().tint(Brand.ink) } else { Text("Giriş yap") }
            }
            .buttonStyle(.aeroPrimary)
            .disabled(!canSubmit)
            .accessibilityIdentifier("login.submit")

            HStack(spacing: 4) {
                Text("Hesabın yok mu?").foregroundStyle(.white.opacity(0.55))
                NavigationLink("Hesap oluştur") { RegisterView() }.fontWeight(.semibold).foregroundStyle(Brand.accent)
            }
            .font(.subheadline)
            .frame(maxWidth: .infinity)
        }
        .animation(.smooth, value: error)
        .onAppear { if email.isEmpty { focus = .email } }
    }

    private var canSubmit: Bool { !busy && !email.isEmpty && !password.isEmpty }

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
            Haptics.attention()
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
        AuthScaffold(title: "Hesap oluştur", subtitle: "Bir dakikadan kısa sürer.") {
            VStack(spacing: AeroTokens.Space.s3) {
                AuthField(icon: "person") {
                    TextField("", text: $fullName, prompt: Text("Ad Soyad").foregroundStyle(.white.opacity(0.4)))
                        .textContentType(.name)
                        .accessibilityIdentifier("register.name")
                }
                AuthField(icon: "envelope") {
                    TextField("", text: $email, prompt: Text("E-posta").foregroundStyle(.white.opacity(0.4)))
                        .textContentType(.emailAddress).keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityIdentifier("register.email")
                }
                AuthField(icon: "lock") {
                    SecureField("", text: $password, prompt: Text("Şifre").foregroundStyle(.white.opacity(0.4)))
                        .textContentType(.newPassword)
                        .accessibilityIdentifier("register.password")
                }
                PasswordPolicyHint(password: password, email: email)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, AeroTokens.Space.s2)
            }
            if let error {
                Label(error, icon: "exclamationmark.circle").font(.subheadline).foregroundStyle(AeroTokens.error)
            }
            Button {
                Task {
                    busy = true; defer { busy = false }
                    do { model.didSignIn(try await model.api.register(email: email, password: password, fullName: fullName)) }
                    catch { self.error = ErrorText.message(error); Haptics.attention() }
                }
            } label: { if busy { ProgressView().tint(Brand.ink) } else { Text("Hesap oluştur") } }
            .buttonStyle(.aeroPrimary)
            .disabled(busy || fullName.isEmpty || email.isEmpty || password.count < 10)
            .accessibilityIdentifier("register.submit")
        }
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
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        AuthScaffold(title: "Şifreni sıfırla", subtitle: "Hesap varsa bu adrese bir sıfırlama bağlantısı göndeririz.") {
            AuthField(icon: "envelope") {
                TextField("", text: $email, prompt: Text("E-posta").foregroundStyle(.white.opacity(0.4)))
                    .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
            }
            if sent {
                Label("İstek alındı. E-postanı kontrol et.", icon: "checkmark.circle.fill")
                    .font(.subheadline).foregroundStyle(AeroTokens.success)
            }
            if let error {
                Label(error, icon: "exclamationmark.circle").font(.subheadline).foregroundStyle(AeroTokens.error)
            }
            Button {
                Task {
                    busy = true; defer { busy = false }
                    do { try await model.api.forgotPassword(email: email); sent = true; error = nil; Haptics.success() }
                    catch { self.error = ErrorText.message(error) }
                }
            } label: { if busy { ProgressView().tint(Brand.ink) } else { Text("Bağlantı gönder") } }
            .buttonStyle(.aeroPrimary)
            .disabled(busy || email.isEmpty)
            Text("Güvenlik nedeniyle hesabın var olup olmadığını göstermiyoruz.")
                .font(.footnote).foregroundStyle(.white.opacity(0.45))
        }
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
