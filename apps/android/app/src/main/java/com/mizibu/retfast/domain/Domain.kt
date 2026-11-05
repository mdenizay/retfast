package com.mizibu.retfast.domain

import com.mizibu.retfast.net.Event
import com.mizibu.retfast.net.Me

object Roles {
    const val PILOT = "pilot"
    const val OBSERVER = "observer"
    const val RETRIEVER = "retriever"
    val ALL = listOf(PILOT, OBSERVER, RETRIEVER)
}

/** Application state shown to a non-member (`Event.me.application`). */
sealed interface ApplicationState {
    data object CanApply : ApplicationState
    data object Closed : ApplicationState
    data class Pending(val id: String) : ApplicationState
    data class Rejected(val id: String, val canReapply: Boolean) : ApplicationState
    data class Withdrawn(val id: String, val canReapply: Boolean) : ApplicationState
}

/** Which bottom sheet the event screen shows: a pure function of the event (the server stays the authority on roles). */
sealed interface EventSheetMode {
    data class NotMember(val state: ApplicationState) : EventSheetMode
    data object Pilot : EventSheetMode
    data object Retriever : EventSheetMode
    data object Observer : EventSheetMode
    /** Organizer without a member role: read-only overview plus organizer tools. */
    data object OrganizerOnly : EventSheetMode

    companion object {
        fun forEvent(event: Event): EventSheetMode = when (event.memberRole) {
            Roles.PILOT -> Pilot
            Roles.RETRIEVER -> Retriever
            Roles.OBSERVER -> Observer
            else -> if (event.isOrganizer) OrganizerOnly else NotMember(applicationState(event))
        }

        fun applicationState(event: Event): ApplicationState {
            val open = event.settings.applicationsOpen
            val app = event.me?.application ?: return if (open) ApplicationState.CanApply else ApplicationState.Closed
            return when (app.status) {
                "pending" -> ApplicationState.Pending(app.id)
                "rejected" -> ApplicationState.Rejected(app.id, open)
                "withdrawn" -> ApplicationState.Withdrawn(app.id, open)
                // "approved" without a role: the membership was removed afterwards.
                else -> if (open) ApplicationState.CanApply else ApplicationState.Closed
            }
        }

        /** Organizer tools are shown in addition to the member sheet. */
        fun showsOrganizerTools(event: Event) = event.isOrganizer

        /** Whether the map should show other pilots (the server filters anyway). */
        fun showsPilotLayer(event: Event): Boolean = when {
            event.isOrganizer -> true
            event.memberRole == Roles.OBSERVER || event.memberRole == Roles.PILOT -> true
            event.memberRole == Roles.RETRIEVER -> false
            else -> event.settings.publicLiveMap
        }
    }
}

/** Where a signed-in user must go before anything else (ADR-003: forced password change). */
sealed interface AuthGate {
    data object SignedOut : AuthGate
    /** Only the change-password screen is reachable. */
    data object MustChangePassword : AuthGate
    data object Open : AuthGate

    companion object {
        fun of(me: Me?): AuthGate = when {
            me == null -> SignedOut
            me.mustChangePassword -> MustChangePassword
            else -> Open
        }
    }
}

/** Local password pre-check mirroring the server policy (>= 10 chars, not the email). The server stays authoritative. */
object PasswordPolicy {
    fun problem(password: String, email: String): String? = when {
        password.length < 10 -> "too_short"
        password.equals(email, ignoreCase = true) -> "equals_email"
        else -> null
    }
}
