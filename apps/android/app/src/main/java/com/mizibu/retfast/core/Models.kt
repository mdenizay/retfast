package com.mizibu.retfast.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** Codable mirrors of supabase/migrations/0001_schema.sql. */

@Serializable
data class Profile(
    val id: String,
    @SerialName("display_name") val displayName: String = "",
    val locale: String = "en",
    @SerialName("is_system_admin") val isSystemAdmin: Boolean = false,
)

@Serializable
data class EventRow(
    val id: String,
    val name: String,
    val description: String = "",
    @SerialName("starts_at") val startsAt: String,
    @SerialName("ends_at") val endsAt: String,
    val visibility: String = "public",
    @SerialName("is_archived") val isArchived: Boolean = false,
)

@Serializable
data class Membership(
    @SerialName("event_id") val eventId: String,
    val role: String,
)

@Serializable
data class GeoZone(
    val id: String,
    val name: String,
    @SerialName("zone_type") val zoneType: String,
    val geometry: JsonElement,
)

@Serializable
data class TaskRow(
    val id: String,
    @SerialName("event_id") val eventId: String,
    @SerialName("pilot_id") val pilotId: String,
    val title: String = "",
    val status: String,
    @SerialName("started_at") val startedAt: String,
    @SerialName("landed_at") val landedAt: String? = null,
    @SerialName("finished_at") val finishedAt: String? = null,
)

@Serializable
data class RetrieverSession(
    val id: String,
    @SerialName("event_id") val eventId: String,
)

@Serializable
data class RetrieverProfileRow(
    val availability: String = "offline",
    @SerialName("vehicle_capacity") val vehicleCapacity: Int = 3,
    @SerialName("occupied_seats") val occupiedSeats: Int = 0,
    @SerialName("vehicle_description") val vehicleDescription: String = "",
)

@Serializable
data class RetrievalRequestRow(
    val id: String,
    @SerialName("event_id") val eventId: String,
    @SerialName("task_id") val taskId: String,
    @SerialName("pilot_id") val pilotId: String,
    @SerialName("retriever_id") val retrieverId: String,
    val status: String,
    @SerialName("expires_at") val expiresAt: String,
)

@Serializable
data class RetrievalAssignmentRow(
    val id: String,
    @SerialName("event_id") val eventId: String,
    @SerialName("task_id") val taskId: String,
    @SerialName("pilot_id") val pilotId: String,
    @SerialName("retriever_id") val retrieverId: String,
    val status: String,
)

@Serializable
data class NearbyRetriever(
    @SerialName("user_id") val userId: String,
    @SerialName("display_name") val displayName: String,
    @SerialName("vehicle_capacity") val vehicleCapacity: Int,
    @SerialName("occupied_seats") val occupiedSeats: Int,
    @SerialName("vehicle_description") val vehicleDescription: String = "",
    @SerialName("distance_m") val distanceM: Double,
    val lat: Double,
    val lng: Double,
)

@Serializable
data class EmergencyRef(val id: String)

@Serializable
data class NameRow(
    val id: String,
    @SerialName("display_name") val displayName: String,
)

/** Roles a member can hold in one event. */
enum class EventRole(val raw: String) {
    PILOT("pilot"),
    RETRIEVER("retriever"),
    OBSERVER("observer"),
    EVENT_ADMIN("event_admin");

    companion object {
        fun from(raw: String): EventRole? = entries.firstOrNull { it.raw == raw }
    }
}
