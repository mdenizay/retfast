package com.mizibu.retfast.ui.common

import android.content.Context
import com.mizibu.retfast.R
import com.mizibu.retfast.net.ApiException

/** Maps contract errors to short user-facing Turkish/English messages (never raw server text for known codes). */
fun ApiException.userMessage(ctx: Context): String = when (this) {
    is ApiException.Transport -> ctx.getString(if (offline) R.string.err_offline else R.string.err_network)
    is ApiException.NotAuthenticated -> ctx.getString(R.string.err_session)
    is ApiException.Decoding -> ctx.getString(R.string.err_unexpected)
    is ApiException.Server -> when (code) {
        "unauthorized" -> ctx.getString(if (status == 401) R.string.err_credentials else R.string.err_session)
        "token_expired" -> ctx.getString(R.string.err_session)
        "password_change_required" -> ctx.getString(R.string.err_password_change_required)
        "forbidden" -> ctx.getString(R.string.err_forbidden)
        "not_found" -> ctx.getString(R.string.err_not_found)
        "conflict" -> ctx.getString(R.string.err_conflict)
        "rate_limited" -> ctx.getString(R.string.err_rate_limited)
        "unavailable" -> ctx.getString(R.string.err_unavailable)
        "validation_failed" -> details.entries.firstOrNull()?.let { "${it.key}: ${it.value}" }?.takeIf { serverMessage.isNullOrBlank() } ?: (serverMessage ?: ctx.getString(R.string.err_validation))
        else -> ctx.getString(R.string.err_unexpected)
    }
}

fun Throwable.userMessage(ctx: Context): String = (this as? ApiException)?.userMessage(ctx) ?: ctx.getString(R.string.err_unexpected)
