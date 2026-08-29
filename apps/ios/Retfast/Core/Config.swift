import Foundation

/// Runtime configuration. Secrets live in `Secrets.plist` (gitignored) —
/// copy `Secrets.example.plist`, fill in the values, and add nothing to git.
enum Config {
    private static let secrets: [String: Any] = {
        guard let url = Bundle.main.url(forResource: "Secrets", withExtension: "plist"),
              let data = try? Data(contentsOf: url),
              let dict = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        else {
            fatalError("Secrets.plist missing — copy Secrets.example.plist and fill it in.")
        }
        return dict
    }()

    static var supabaseURL: URL {
        guard let raw = secrets["SUPABASE_URL"] as? String, let url = URL(string: raw) else {
            fatalError("SUPABASE_URL missing in Secrets.plist")
        }
        return url
    }

    static var supabaseAnonKey: String {
        guard let key = secrets["SUPABASE_ANON_KEY"] as? String, !key.isEmpty else {
            fatalError("SUPABASE_ANON_KEY missing in Secrets.plist")
        }
        return key
    }
}
