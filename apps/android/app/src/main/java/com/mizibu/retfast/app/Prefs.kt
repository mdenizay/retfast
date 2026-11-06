package com.mizibu.retfast.app

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Small per-device preferences (not secrets, not flight data). */
class Prefs(context: Context) {
    private val sp = context.applicationContext.getSharedPreferences("retfast_prefs", Context.MODE_PRIVATE)

    private val _theme = MutableStateFlow(sp.getString("theme", "system") ?: "system")
    /** "system" | "light" | "dark" */
    val theme: StateFlow<String> = _theme
    fun setTheme(v: String) { sp.edit().putString("theme", v).apply(); _theme.value = v }

    private val _highContrast = MutableStateFlow(sp.getBoolean("high_contrast", true))
    /** High-contrast outdoor flight-computer theme. */
    val flightHighContrast: StateFlow<Boolean> = _highContrast
    fun setFlightHighContrast(v: Boolean) { sp.edit().putBoolean("high_contrast", v).apply(); _highContrast.value = v }

    private val _units = MutableStateFlow(sp.getString("units", "metric") ?: "metric")
    val units: StateFlow<String> = _units
    fun setUnits(v: String) { sp.edit().putString("units", v).apply(); _units.value = v }

    private val _basemap = MutableStateFlow(sp.getString("basemap", "standard") ?: "standard")
    /** "standard" | "topo" | "satellite" */
    val basemap: StateFlow<String> = _basemap
    fun setBasemap(v: String) { sp.edit().putString("basemap", v).apply(); _basemap.value = v }

    private val _onboarded = MutableStateFlow(sp.getBoolean("onboarded", false))
    val onboarded: StateFlow<Boolean> = _onboarded
    fun setOnboarded(v: Boolean) { sp.edit().putBoolean("onboarded", v).apply(); _onboarded.value = v }

    fun sharingNoticeAcked(eventId: String) = sp.getBoolean("share_ack_$eventId", false)
    fun ackSharingNotice(eventId: String) { sp.edit().putBoolean("share_ack_$eventId", true).apply() }

    fun backgroundRationaleSeen() = sp.getBoolean("bg_rationale", false)
    fun setBackgroundRationaleSeen() { sp.edit().putBoolean("bg_rationale", true).apply() }

    fun batteryPromptDismissed() = sp.getBoolean("battery_dismissed", false)
    fun setBatteryPromptDismissed(v: Boolean) { sp.edit().putBoolean("battery_dismissed", v).apply() }

    /** Cached for the offline case: lets the app open to the cached name. */
    var lastUserName: String?
        get() = sp.getString("last_user_name", null)
        set(v) { sp.edit().putString("last_user_name", v).apply() }
}
