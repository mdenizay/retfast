import Foundation
import Supabase

@MainActor
final class AuthModel: ObservableObject {
    @Published var session: Session?
    @Published var profile: Profile?
    @Published var loading = true

    private var watchTask: Task<Void, Never>?

    init() {
        watchTask = Task {
            for await state in supa.auth.authStateChanges {
                self.session = state.session
                if let user = state.session?.user {
                    await loadProfile(user.id)
                } else {
                    self.profile = nil
                }
                self.loading = false
            }
        }
    }

    deinit { watchTask?.cancel() }

    func loadProfile(_ userId: UUID) async {
        profile = try? await supa.from("profiles")
            .select()
            .eq("id", value: userId)
            .single()
            .execute()
            .value
    }

    func signIn(email: String, password: String) async throws {
        try await supa.auth.signIn(email: email, password: password)
    }

    func signUp(email: String, password: String, displayName: String, locale: String) async throws {
        try await supa.auth.signUp(
            email: email,
            password: password,
            data: ["display_name": .string(displayName), "locale": .string(locale)]
        )
    }

    func signOut() async {
        try? await supa.auth.signOut()
    }
}
