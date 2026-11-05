package com.mizibu.retfast.net

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNamingStrategy

@OptIn(ExperimentalSerializationApi::class)
val ApiJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
    isLenient = true
    namingStrategy = JsonNamingStrategy.SnakeCase
}

@Serializable
data class Preferences(val units: String = "metric", val publicProfile: Boolean = false)

@Serializable
data class PilotProfile(
    val publicId: String = "",
    val displayName: String = "",
    val bio: String = "",
    val wing: String = "",
    val licenseNo: String = "",
    val nationality: String = "",
    val phone: String = "",
    val emergencyContactName: String = "",
    val emergencyContactPhone: String = "",
)

@Serializable
data class Me(
    val id: String,
    val email: String = "",
    val emailVerified: Boolean = false,
    val fullName: String = "",
    val roles: List<String> = emptyList(),
    val mustChangePassword: Boolean = false,
    val createdAt: String? = null,
    val pilot: PilotProfile? = null,
    val preferences: Preferences = Preferences(),
)

@Serializable
data class AuthResponse(
    val accessToken: String,
    val accessExpiresAt: String? = null,
    val refreshToken: String? = null,
    val refreshExpiresAt: String? = null,
    val user: Me,
)

@Serializable data class LoginRequest(val email: String, val password: String, val client: String, val deviceName: String? = null)
@Serializable data class RegisterRequest(val email: String, val password: String, val fullName: String, val client: String, val deviceName: String? = null)
@Serializable data class RefreshRequest(val refreshToken: String)
@Serializable data class LogoutRequest(val refreshToken: String? = null)
@Serializable data class ChangePasswordRequest(val currentPassword: String, val newPassword: String)
@Serializable data class ForgotRequest(val email: String)
@Serializable data class ResetRequest(val token: String, val newPassword: String)
@Serializable data class DeletionRequest(val reason: String? = null)

@Serializable
data class LatLon(val lat: Double, val lon: Double)

@Serializable
data class EventSettings(
    val applicationsOpen: Boolean = false,
    val liveTracking: Boolean = true,
    val publicLiveMap: Boolean = false,
    val pilotsSeeEachOther: Boolean = false,
    val landingPrompt: Boolean = true,
)

@Serializable data class OrganizerRef(val userId: String, val fullName: String = "")

@Serializable
data class EventCounts(
    val pilots: Int = 0,
    val observers: Int = 0,
    val retrievers: Int = 0,
    val pendingApplications: Int? = null,
)

@Serializable data class ApplicationRef(val id: String, val status: String)

@Serializable
data class EventMe(
    val isOrganizer: Boolean = false,
    val role: String? = null,
    val application: ApplicationRef? = null,
)

@Serializable
data class Event(
    val id: String,
    val slug: String = "",
    val name: String = "",
    val description: String = "",
    val kind: String = "paragliding",
    val status: String = "",
    val isDemo: Boolean = false,
    val visibility: String = "public",
    val locationName: String = "",
    val center: LatLon? = null,
    val centerIsApproximate: Boolean = false,
    val startsAt: String? = null,
    val endsAt: String? = null,
    val settings: EventSettings = EventSettings(),
    val organizers: List<OrganizerRef> = emptyList(),
    val counts: EventCounts = EventCounts(),
    val me: EventMe? = null,
) {
    val isOrganizer: Boolean get() = me?.isOrganizer == true
    val memberRole: String? get() = me?.role
}

@Serializable
data class LaunchSite(
    val id: String,
    val eventId: String = "",
    val name: String = "",
    val position: LatLon? = null,
    val elevationM: Double? = null,
    val notes: String = "",
    val isVerified: Boolean = false,
)

@Serializable data class UserRef(val userId: String = "", val fullName: String = "", val email: String = "", val publicId: String = "", val phone: String = "")

@Serializable
data class Member(
    val userId: String,
    val fullName: String = "",
    val publicId: String = "",
    val role: String? = null,
    val isOrganizer: Boolean = false,
    val status: String = "active",
    val phone: String = "",
)

@Serializable
data class Application(
    val id: String,
    val eventId: String = "",
    val user: UserRef = UserRef(),
    val message: String = "",
    val status: String = "pending",
    val grantedRole: String? = null,
    val createdAt: String? = null,
)

@Serializable data class ItemsOf<T>(val items: List<T> = emptyList(), val nextCursor: String? = null)
@Serializable data class ApplyRequest(val message: String? = null)
@Serializable data class ApproveRequest(val role: String, val note: String? = null)
@Serializable data class RejectRequest(val note: String? = null)

@Serializable
data class Position(
    val id: String? = null,
    val seq: Int? = null,
    val t: String? = null,
    val receivedAt: String? = null,
    val lat: Double,
    val lon: Double,
    val gpsAltM: Double? = null,
    val hAccM: Double? = null,
    val vAccM: Double? = null,
    val speedMs: Double? = null,
    val courseDeg: Double? = null,
)

@Serializable
data class FlightStats(
    val durationS: Double = 0.0,
    val distanceM: Double = 0.0,
    val maxGpsAltM: Double? = null,
    val minGpsAltM: Double? = null,
    val maxGroundSpeedMs: Double? = null,
    val totalAscentM: Double = 0.0,
    val totalDescentM: Double = 0.0,
    val sampleCount: Int = 0,
)

@Serializable
data class Flight(
    val id: String,
    val publicId: String = "",
    val eventId: String? = null,
    val status: String = "",
    val isSimulated: Boolean = false,
    val startedAt: String? = null,
    val endedAt: String? = null,
    val lastPosition: Position? = null,
    val stats: FlightStats = FlightStats(),
)

@Serializable data class DeviceInfo(val platform: String = "android", val appVersion: String = "", val osVersion: String = "")

@Serializable
data class CreateFlightRequest(
    val id: String,
    val eventId: String? = null,
    val startedAt: String,
    val isSimulated: Boolean = false,
    val device: DeviceInfo,
)

@Serializable data class EndFlightRequest(val endedAt: String)

@Serializable
data class SampleMeta(val profile: String, val battery: Double? = null, val lowPower: Boolean = false)

@Serializable
data class SampleDto(
    val id: String,
    val seq: Int,
    val t: String,
    val deviceT: String,
    val lat: Double,
    val lon: Double,
    val gpsAltM: Double? = null,
    val hAccM: Double,
    val vAccM: Double? = null,
    val speedMs: Double? = null,
    val courseDeg: Double? = null,
    val meta: SampleMeta? = null,
)

@Serializable data class BatchRequest(val batchId: String, val flightId: String, val samples: List<SampleDto>)
@Serializable data class Rejected(val seq: Int, val reason: String = "")

@Serializable
data class BatchResponse(
    val batchId: String = "",
    val accepted: List<Int> = emptyList(),
    val duplicate: List<Int> = emptyList(),
    val rejected: List<Rejected> = emptyList(),
    val maxAckedSeq: Int? = null,
    val serverTime: String? = null,
)

// ---- Live / retrievals

@Serializable data class PilotRef(val userId: String = "", val fullName: String = "", val publicId: String = "", val phone: String = "")
@Serializable data class ActorRef(val userId: String = "", val fullName: String = "", val phone: String = "")

@Serializable
data class LivePilot(
    val flightId: String,
    val pilot: PilotRef = PilotRef(),
    val isSimulated: Boolean = false,
    val status: String = "recording",
    val position: Position? = null,
    val ageS: Double = 0.0,
    val freshness: String = "live",
    val trail: List<List<Double>> = emptyList(),
)

@Serializable
data class LiveRetriever(
    val userId: String,
    val fullName: String = "",
    val onDuty: Boolean = false,
    val position: Position? = null,
    val ageS: Double? = null,
    val activeRetrievals: Int = 0,
)

@Serializable
data class LiveSnapshot(
    val eventId: String = "",
    val serverTime: String? = null,
    val cursor: String? = null,
    val pilots: List<LivePilot> = emptyList(),
    val retrievals: List<Retrieval> = emptyList(),
    val retrievers: List<LiveRetriever> = emptyList(),
)

@Serializable
data class RetrievalPickup(val lat: Double, val lon: Double, val gpsAltM: Double? = null, val hAccM: Double? = null, val t: String? = null)

@Serializable
data class SimplePosition(val lat: Double, val lon: Double, val hAccM: Double? = null, val t: String? = null, val courseDeg: Double? = null, val speedMs: Double? = null)

@Serializable
data class RetrievalUpdate(val id: String = "", val kind: String = "", val body: String = "", val createdAt: String? = null)

@Serializable
data class Retrieval(
    val id: String,
    val eventId: String? = null,
    val flightId: String? = null,
    val pilot: PilotRef? = null,
    val status: String = "requested",
    val pickup: RetrievalPickup? = null,
    val pilotPosition: Position? = null,
    val note: String = "",
    val retriever: ActorRef? = null,
    val retrieverPosition: SimplePosition? = null,
    val requestedAt: String? = null,
    val acceptedAt: String? = null,
    val pickedUpAt: String? = null,
    val deliveredAt: String? = null,
    val cancelledAt: String? = null,
    val cancelReason: String = "",
    val deliveryNote: String = "",
    val isSimulated: Boolean = false,
    val updates: List<RetrievalUpdate> = emptyList(),
)

@Serializable
data class CreateRetrievalRequest(val id: String, val flightId: String? = null, val pickup: RetrievalPickup, val note: String? = null)
@Serializable data class CancelRequest(val reason: String? = null)
@Serializable data class DeliveredRequest(val note: String? = null)
@Serializable data class DutyRequest(val onDuty: Boolean)
@Serializable data class SharePositionRequest(val lat: Double, val lon: Double, val hAccM: Double, val t: String, val gpsAltM: Double? = null, val courseDeg: Double? = null, val speedMs: Double? = null)

@Serializable data class ErrorBody(val error: ErrorInner? = null)
@Serializable data class ErrorInner(val code: String = "", val message: String = "", val details: kotlinx.serialization.json.JsonObject? = null)

object RetrievalStatus {
    const val REQUESTED = "requested"
    const val ACCEPTED = "accepted"
    const val PICKED_UP = "picked_up"
    const val DELIVERED = "delivered"
    const val CANCELLED = "cancelled"
    val OPEN = listOf(REQUESTED, ACCEPTED, PICKED_UP)
    fun isOpen(s: String?) = s in OPEN
    fun isTerminal(s: String?) = s == DELIVERED || s == CANCELLED
}
