package com.mizibu.retfast.core

import com.mizibu.retfast.BuildConfig
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.functions.Functions
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.serializer.KotlinXSerializer
import kotlinx.serialization.json.Json

/**
 * Single shared Supabase client. The anon key is public by design — RLS in
 * Postgres is the actual authorization boundary (see docs/rls.md).
 */
val supa: SupabaseClient by lazy {
    createSupabaseClient(
        supabaseUrl = BuildConfig.SUPABASE_URL,
        supabaseKey = BuildConfig.SUPABASE_ANON_KEY,
    ) {
        install(Auth)
        install(Postgrest)
        install(Functions)
        defaultSerializer = KotlinXSerializer(
            Json {
                ignoreUnknownKeys = true
                explicitNulls = false
                coerceInputValues = true
            },
        )
    }
}

val appJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
}
