package com.mizibu.retfast.retrieval

import com.mizibu.retfast.data.Outbox
import com.mizibu.retfast.data.RetrievalEntity
import com.mizibu.retfast.net.ApiJson
import com.mizibu.retfast.net.Retrieval
import com.mizibu.retfast.net.RetrievalStatus

/** What the pilot's waiting screen shows. Derived purely from the stored row; never invents progress. */
enum class RetrievalStage {
    /** On the phone only; no send attempt yet. */
    SAVED_LOCALLY,
    /** Being sent / retried; not confirmed by the server. */
    SENDING,
    /** Server has it; waiting for a retriever to accept. */
    REQUESTED,
    ACCEPTED,
    PICKED_UP,
    DELIVERED,
    /** Pilot cancelled; the server has not confirmed yet. */
    CANCELLING,
    CANCELLED,
    /** The server refused the request (reason in lastError). */
    REFUSED,
    /** Folded into another open request of the same pilot. */
    MERGED;

    /** Index on the 4-step ladder requested -> accepted -> picked up -> delivered of the last step the server confirmed. */
    val confirmedStep: Int? get() = when (this) { REQUESTED -> 0; ACCEPTED -> 1; PICKED_UP -> 2; DELIVERED -> 3; else -> null }

    /** The pilot keeps sharing their position until picked up or the request ended. */
    val sharesPilotPosition: Boolean get() = this == REQUESTED || this == ACCEPTED

    val isFinished: Boolean get() = this == DELIVERED || this == CANCELLED || this == REFUSED || this == MERGED
}

val RetrievalEntity.stage: RetrievalStage
    get() {
        when (outbox) {
            Outbox.REFUSED -> return RetrievalStage.REFUSED
            Outbox.MERGED -> return RetrievalStage.MERGED
            Outbox.PENDING -> {
                if (cancelSynced) return RetrievalStage.CANCELLED
                if (cancelRequested) return RetrievalStage.CANCELLING
                return if (attemptCount == 0) RetrievalStage.SAVED_LOCALLY else RetrievalStage.SENDING
            }
        }
        if (cancelRequested && !cancelSynced && (serverStatus == null || RetrievalStatus.isOpen(serverStatus))) return RetrievalStage.CANCELLING
        return when (serverStatus) {
            null, RetrievalStatus.REQUESTED -> RetrievalStage.REQUESTED
            RetrievalStatus.ACCEPTED -> RetrievalStage.ACCEPTED
            RetrievalStatus.PICKED_UP -> RetrievalStage.PICKED_UP
            RetrievalStatus.DELIVERED -> RetrievalStage.DELIVERED
            RetrievalStatus.CANCELLED -> RetrievalStage.CANCELLED
            else -> RetrievalStage.REQUESTED
        }
    }

/** Nothing more will happen to this request. */
val RetrievalEntity.isTerminal: Boolean
    get() = when (outbox) {
        Outbox.REFUSED, Outbox.MERGED -> true
        Outbox.PENDING -> cancelSynced
        else -> RetrievalStatus.isTerminal(serverStatus) && (!cancelRequested || cancelSynced)
    }

val RetrievalEntity.server: Retrieval?
    get() = serverJson?.let { runCatching { ApiJson.decodeFromString(Retrieval.serializer(), it) }.getOrNull() }

/** Phone shares the pilot's position while waiting. */
sealed interface SharingMode {
    data object Off : SharingMode
    /** Landed pilot waiting: `POST /retrievals/{id}/position` about every 30 s. */
    data class PilotWaiting(val retrievalId: String, val eventId: String) : SharingMode
    /** Retriever on duty or holding pickups: `POST /events/{id}/retrievers/me/position` about every 15 s. */
    data class Retriever(val eventId: String) : SharingMode

    companion object {
        /** A waiting pilot wins over retriever duty: a stranded pilot's position matters most. */
        fun decide(active: RetrievalEntity?, duty: RetrieverDuty?): SharingMode {
            if (active != null && active.outbox == Outbox.SENT && active.stage.sharesPilotPosition) return PilotWaiting(active.id, active.eventId)
            if (duty != null && duty.needsSharing) return Retriever(duty.eventId)
            return Off
        }

        fun isDue(nowMs: Long, lastSentAt: Long?, lastSentFixAt: Long?, latestFixAt: Long?, intervalS: Double): Boolean {
            if (latestFixAt == null) return false
            if (lastSentFixAt != null && latestFixAt <= lastSentFixAt) return false
            if (lastSentAt == null) return true
            return (nowMs - lastSentAt) / 1000.0 >= intervalS
        }
    }
}

@kotlinx.serialization.Serializable
data class RetrieverDuty(val eventId: String, val eventName: String? = null, val onDuty: Boolean, val activePickups: Int = 0) {
    val needsSharing: Boolean get() = onDuty || activePickups > 0
}
