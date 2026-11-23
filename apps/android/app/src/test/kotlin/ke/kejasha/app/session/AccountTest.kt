package ke.kejasha.app.session

import ke.kejasha.api.models.Me
import ke.kejasha.api.models.Membership
import ke.kejasha.api.models.OrgKind
import ke.kejasha.api.models.PortalLease
import ke.kejasha.api.models.PortalMe
import ke.kejasha.api.models.PortalTenancy
import ke.kejasha.api.models.Role
import ke.kejasha.api.models.User
import ke.kejasha.app.net.ApiJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class AccountTest {
    private val user = User(UUID.randomUUID(), "Wanjiku", null, "+254712345678", false, true)
    private fun member(role: Role) = Membership(UUID.randomUUID(), "Acacia Homes", OrgKind.LANDLORD, role)
    private val tenancy = PortalTenancy(
        UUID.randomUUID(),
        "Otieno",
        listOf(PortalLease(UUID.randomUUID(), "A1", "Acacia", "2026-01-01", null, PortalLease.Status.ACTIVE, 2_500_000, 150_000)),
    )

    @Test fun `the shell follows the active role`() {
        mapOf(
            Role.OWNER to Shell.OWNER, Role.MANAGER to Shell.OWNER, Role.AGENT to Shell.OWNER,
            Role.CARETAKER to Shell.CARETAKER, Role.VIEWER to Shell.VIEWER,
        ).forEach { (role, shell) ->
            val m = member(role)
            val account = resolveAccount(Me(user, m, listOf(m)), null) as Account.Staff
            assertEquals(shell, account.shell)
        }
    }

    @Test fun `a member without an active org uses the first membership`() {
        val m = member(Role.CARETAKER)
        assertEquals(m, (resolveAccount(Me(user, null, listOf(m)), null) as Account.Staff).active)
    }

    @Test fun `no membership but tenancies is a tenant`() {
        val account = resolveAccount(Me(user, null, emptyList()), PortalMe(user.phone, true, listOf(tenancy)))
        assertTrue(account is Account.Tenant)
    }

    @Test fun `no membership and no tenancy has no access`() {
        assertTrue(resolveAccount(Me(user, null, emptyList()), PortalMe(user.phone, true, emptyList())) is Account.NoAccess)
    }

    @Test fun `the account round-trips through the offline cache`() {
        val account: Account = resolveAccount(Me(user, null, emptyList()), PortalMe(user.phone, true, listOf(tenancy)))
        val json = ApiJson.encodeToString(Account.serializer(), account)
        assertEquals(account, ApiJson.decodeFromString(Account.serializer(), json))
    }
}
