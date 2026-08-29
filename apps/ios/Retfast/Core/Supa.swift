import Foundation
import Supabase

/// Single shared Supabase client.
let supa = SupabaseClient(
    supabaseURL: Config.supabaseURL,
    supabaseKey: Config.supabaseAnonKey
)
