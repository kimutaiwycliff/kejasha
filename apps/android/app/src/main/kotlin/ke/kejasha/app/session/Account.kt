package ke.kejasha.app.session

import ke.kejasha.api.models.Me
import ke.kejasha.api.models.Membership
import ke.kejasha.api.models.PortalMe
import ke.kejasha.api.models.Role
import ke.kejasha.api.models.User
import kotlinx.serialization.Serializable

/** Who is signed in and which shell they see. */
@Serializable
sealed interface Account {
    val user: User

    /** A member of an organization: the shell follows the role in the active org. */
    @Serializable
    data class Staff(override val user: User, val active: Membership, val memberships: List<Membership>) : Account {
        val shell: Shell
            get() = when (active.role) {
                Role.OWNER, Role.MANAGER, Role.AGENT -> Shell.OWNER
                Role.CARETAKER -> Shell.CARETAKER
                Role.VIEWER -> Shell.VIEWER
            }
    }

    /** No membership, but landlords hold this phone on a tenant record. */
    @Serializable
    data class Tenant(override val user: User, val portal: PortalMe) : Account

    /** Signed in, but nothing to show yet: set up on the web app. */
    @Serializable
    data class NoAccess(override val user: User) : Account
}

enum class Shell { OWNER, CARETAKER, VIEWER }

/** Staff shell when the user has memberships; otherwise the tenant portal if they have tenancies. */
fun resolveAccount(me: Me, portal: PortalMe?): Account {
    val active = me.activeOrg ?: me.memberships.firstOrNull()
    return when {
        active != null -> Account.Staff(me.user, active, me.memberships)
        portal != null && portal.tenancies.isNotEmpty() -> Account.Tenant(me.user, portal)
        else -> Account.NoAccess(me.user)
    }
}
