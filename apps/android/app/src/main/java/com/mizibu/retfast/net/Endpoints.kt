package com.mizibu.retfast.net

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Thin typed wrappers over the contract in docs/architecture/api-contract.md.

suspend fun ApiClient.me(): Me = get("me")

suspend fun ApiClient.patchPilot(p: PilotProfile): PilotProfile = send("PATCH", "me/pilot", PilotProfile.serializer(), body = encode(p))

suspend fun ApiClient.patchPreferences(units: String? = null, publicProfile: Boolean? = null): Me {
    val body = buildJsonObject {
        put("preferences", buildJsonObject {
            units?.let { put("units", it) }
            publicProfile?.let { put("public_profile", it) }
        })
    }
    return send("PATCH", "me", Me.serializer(), body = body.toString())
}

suspend fun ApiClient.patchFullName(name: String): Me =
    send("PATCH", "me", Me.serializer(), body = buildJsonObject { put("full_name", name) }.toString())

suspend fun ApiClient.requestDeletion(reason: String?) { sendRaw("POST", "me/deletion-request", body = encode(DeletionRequest(reason))) }
suspend fun ApiClient.cancelDeletion() { sendRaw("DELETE", "me/deletion-request") }

suspend fun ApiClient.events(mine: Boolean? = null, q: String? = null): List<Event> {
    val query = buildMap { if (mine == true) put("mine", "true"); if (!q.isNullOrBlank()) put("q", q) }
    return send("GET", "events", ItemsOf.serializer(Event.serializer()), query).items
}

suspend fun ApiClient.event(id: String): Event = get("events/$id")
suspend fun ApiClient.launchSites(eventId: String): List<LaunchSite> =
    send("GET", "events/$eventId/launch-sites", ItemsOf.serializer(LaunchSite.serializer())).items

suspend fun ApiClient.live(eventId: String): LiveSnapshot = get("events/$eventId/live")

suspend fun ApiClient.apply(eventId: String, message: String?) {
    sendRaw("POST", "events/$eventId/applications", body = encode(ApplyRequest(message?.takeIf { it.isNotBlank() })))
}
suspend fun ApiClient.withdraw(eventId: String, applicationId: String) { sendRaw("POST", "events/$eventId/applications/$applicationId/withdraw", body = "{}") }
suspend fun ApiClient.applications(eventId: String, status: String? = "pending"): List<Application> =
    send("GET", "events/$eventId/applications", ItemsOf.serializer(Application.serializer()), buildMap { status?.let { put("status", it) } }).items

/** Role is required: the organizer always chooses it explicitly. */
suspend fun ApiClient.approve(eventId: String, applicationId: String, role: String) {
    require(role in listOf("pilot", "observer", "retriever")) { "role required" }
    sendRaw("POST", "events/$eventId/applications/$applicationId/approve", body = encode(ApproveRequest(role)))
}
suspend fun ApiClient.reject(eventId: String, applicationId: String, note: String? = null) {
    sendRaw("POST", "events/$eventId/applications/$applicationId/reject", body = encode(RejectRequest(note)))
}
suspend fun ApiClient.members(eventId: String): List<Member> =
    send("GET", "events/$eventId/members", ItemsOf.serializer(Member.serializer())).items

suspend fun ApiClient.flights(): List<Flight> = send("GET", "flights", ItemsOf.serializer(Flight.serializer()), mapOf("limit" to "100")).items
suspend fun ApiClient.createFlight(body: CreateFlightRequest): Flight = post("flights", body)
suspend fun ApiClient.endFlight(id: String, endedAtIso: String): Flight = post("flights/$id/end", EndFlightRequest(endedAtIso))
suspend fun ApiClient.uploadBatch(body: BatchRequest): BatchResponse = post("telemetry/batches", body)

suspend fun ApiClient.createRetrieval(eventId: String, body: CreateRetrievalRequest): Retrieval = post("events/$eventId/retrievals", body)
suspend fun ApiClient.retrieval(id: String): Retrieval = get("retrievals/$id")
suspend fun ApiClient.retrievals(eventId: String, statuses: List<String>? = null): List<Retrieval> =
    send("GET", "events/$eventId/retrievals", ItemsOf.serializer(Retrieval.serializer()),
        buildMap { statuses?.let { put("status", it.joinToString(",")) } }).items
suspend fun ApiClient.cancelRetrieval(id: String, reason: String?): Retrieval = post("retrievals/$id/cancel", CancelRequest(reason))
suspend fun ApiClient.acceptRetrieval(id: String): Retrieval = postEmpty("retrievals/$id/accept")
suspend fun ApiClient.releaseRetrieval(id: String): Retrieval = postEmpty("retrievals/$id/release")
suspend fun ApiClient.pickedUp(id: String): Retrieval = postEmpty("retrievals/$id/picked-up")
suspend fun ApiClient.delivered(id: String, note: String?): Retrieval = post("retrievals/$id/delivered", DeliveredRequest(note))
suspend fun ApiClient.sendPilotPosition(retrievalId: String, p: SharePositionRequest) {
    sendRaw("POST", "retrievals/$retrievalId/position", body = encode(p))
}
suspend fun ApiClient.sendRetrieverPosition(eventId: String, p: SharePositionRequest) {
    sendRaw("POST", "events/$eventId/retrievers/me/position", body = encode(p))
}
suspend fun ApiClient.setDuty(eventId: String, onDuty: Boolean) {
    sendRaw("PUT", "events/$eventId/retrievers/me/duty", body = encode(DutyRequest(onDuty)))
}

/** Positions of a flight for the route view (simplified server side). */
suspend fun ApiClient.flightPositions(id: String): List<Position> =
    send("GET", "flights/$id/positions", ItemsOf.serializer(Position.serializer()), mapOf("simplify" to "true", "limit" to "5000")).items

