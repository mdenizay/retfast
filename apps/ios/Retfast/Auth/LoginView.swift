import SwiftUI

struct LoginView: View {
    @EnvironmentObject var auth: AuthModel
    @State private var mode: Mode = .signIn
    @State private var email = ""
    @State private var password = ""
    @State private var displayName = ""
    @State private var error: String?
    @State private var busy = false

    enum Mode { case signIn, signUp }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 10) {
                        RetfastMark(size: 64)
                        Text("LIVE FLIGHT OPERATIONS")
                            .font(.caption2.weight(.bold))
                            .tracking(2)
                            .foregroundStyle(RetfastBrand.amber)
                        Text("RETFAST")
                            .font(.largeTitle.weight(.black))
                            .tracking(-1.5)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .listRowBackground(Color.clear)
                }
                Section {
                    if mode == .signUp {
                        TextField(String(localized: "auth.displayName"), text: $displayName).minTapTarget()
                    }
                    TextField(String(localized: "auth.email"), text: $email)
                        .minTapTarget()
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField(String(localized: "auth.password"), text: $password).minTapTarget()
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red).font(.footnote) }
                }
                Section {
                    Button(action: submit) {
                        if busy {
                            ProgressView()
                        } else {
                            Text(mode == .signIn ? "auth.signIn" : "auth.signUp")
                        }
                    }
                    .buttonStyle(.big(.primary, height: Hit.comfortable))
                    .disabled(busy || email.isEmpty || password.count < 8)
                    .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))

                    Button(mode == .signIn ? "auth.toSignUp" : "auth.toSignIn") {
                        mode = mode == .signIn ? .signUp : .signIn
                        error = nil
                    }
                    .buttonStyle(.borderless)
                    .minTapTarget()
                }
            }
            .scrollContentBackground(.hidden)
            .background(RetfastBrand.graphite)
            .navigationBarHidden(true)
        }
    }

    private func submit() {
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                if mode == .signIn {
                    try await auth.signIn(email: email, password: password)
                } else {
                    let locale = Locale.current.language.languageCode?.identifier == "tr" ? "tr" : "en"
                    try await auth.signUp(
                        email: email, password: password,
                        displayName: displayName, locale: locale
                    )
                }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
