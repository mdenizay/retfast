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
                    if mode == .signUp {
                        TextField(String(localized: "auth.displayName"), text: $displayName)
                    }
                    TextField(String(localized: "auth.email"), text: $email)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField(String(localized: "auth.password"), text: $password)
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red).font(.footnote) }
                }
                Section {
                    Button(action: submit) {
                        if busy {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Text(mode == .signIn ? "auth.signIn" : "auth.signUp")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .disabled(busy || email.isEmpty || password.count < 8)
                    Button(mode == .signIn ? "auth.toSignUp" : "auth.toSignIn") {
                        mode = mode == .signIn ? .signUp : .signIn
                        error = nil
                    }
                    .font(.footnote)
                }
            }
            .navigationTitle("RETFAST")
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
