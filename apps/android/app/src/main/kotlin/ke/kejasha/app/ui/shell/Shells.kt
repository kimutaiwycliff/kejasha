package ke.kejasha.app.ui.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material.icons.outlined.Today
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.selection.selectable
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ke.kejasha.api.models.Role as MemberRole
import ke.kejasha.app.session.Account
import ke.kejasha.app.session.Shell
import ke.kejasha.app.ui.Centered
import ke.kejasha.app.ui.SessionViewModel
import ke.kejasha.app.util.formatKes

private class Tab(val label: String, val icon: ImageVector, val content: @Composable () -> Unit)

private val ROLE_LABEL = mapOf(
    MemberRole.OWNER to "Owner",
    MemberRole.MANAGER to "Manager",
    MemberRole.AGENT to "Agent",
    MemberRole.CARETAKER to "Caretaker",
    MemberRole.VIEWER to "Viewer",
)

/** Owner/manager/agent, caretaker and viewer shells: the tabs follow the role in the active org. */
@Composable
fun StaffShell(account: Account.Staff, offline: Boolean, vm: SessionViewModel) {
    val more = Tab("More", Icons.Outlined.Menu) { AccountPane(account, vm) }
    val tabs = when (account.shell) {
        Shell.OWNER -> listOf(
            Tab("Today", Icons.Outlined.Today) { Upcoming("Today") },
            Tab("Money", Icons.Outlined.Payments) { Upcoming("Money") },
            Tab("Stays", Icons.Outlined.CalendarMonth) { Upcoming("Stays") },
            Tab("Repairs", Icons.Outlined.Build) { Upcoming("Repairs") },
            more,
        )
        Shell.CARETAKER -> listOf(
            Tab("Round", Icons.Outlined.Speed) { Upcoming("Meter round") },
            Tab("Repairs", Icons.Outlined.Build) { Upcoming("Repairs") },
            Tab("Cash", Icons.Outlined.Payments) { Upcoming("Cash") },
            Tab("Sync", Icons.Outlined.Sync) { Upcoming("Sync") },
            more,
        )
        Shell.VIEWER -> listOf(
            Tab("Today", Icons.Outlined.Today) { Upcoming("Today") },
            Tab("Statements", Icons.AutoMirrored.Outlined.ReceiptLong) { Upcoming("Statements") },
            more,
        )
    }
    // Reset to the first tab when the org (and so the shell) changes.
    ShellScaffold(title = account.active.orgName, offline = offline, tabs = tabs, key = account.active.orgId.toString(), vm = vm)
}

/** Tenant portal: balances and pay (A3) across every landlord that holds this phone. */
@Composable
fun TenantShell(account: Account.Tenant, offline: Boolean, vm: SessionViewModel) {
    val tabs = listOf(
        Tab("Home", Icons.Outlined.Home) { TenantHome(account) },
        Tab("Statement", Icons.AutoMirrored.Outlined.ReceiptLong) { Upcoming("Statement") },
        Tab("Repairs", Icons.Outlined.Build) { Upcoming("Repairs") },
        Tab("More", Icons.Outlined.Menu) { AccountPane(account, vm) },
    )
    ShellScaffold(title = "My home", offline = offline, tabs = tabs, key = "tenant", vm = vm)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ShellScaffold(title: String, offline: Boolean, tabs: List<Tab>, key: String, vm: SessionViewModel) {
    var selected by rememberSaveable(key) { mutableIntStateOf(0) }
    val snackbar = remember { SnackbarHostState() }
    val message by vm.message.collectAsStateWithLifecycle()
    LaunchedEffect(message) {
        message?.let { snackbar.showSnackbar(it); vm.messageShown() }
    }
    Scaffold(
        topBar = { TopAppBar(title = { Text(title) }) },
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            NavigationBar {
                tabs.forEachIndexed { i, tab ->
                    NavigationBarItem(
                        selected = i == selected,
                        onClick = { selected = i },
                        icon = { Icon(tab.icon, contentDescription = null) },
                        label = { Text(tab.label) },
                        modifier = Modifier.testTag("tab-${tab.label.lowercase()}"),
                    )
                }
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            if (offline) {
                Text(
                    "Offline — showing what was saved on this phone.",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
            tabs[selected.coerceIn(tabs.indices)].content()
        }
    }
}

/** A tab whose screens arrive in a later slice of phase A. */
@Composable
private fun Upcoming(name: String) = Centered {
    Text(name, style = MaterialTheme.typography.titleLarge)
    Text("This screen is on its way. Use the web app for now.", textAlign = TextAlign.Center)
}

@Composable
private fun TenantHome(account: Account.Tenant) {
    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Hello ${account.user.name}", style = MaterialTheme.typography.titleLarge)
        account.portal.tenancies.forEach { tenancy ->
            Text(tenancy.landlordName, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
            tenancy.leases.forEach { lease ->
                ListItem(
                    headlineContent = { Text("${lease.unitCode} · ${lease.propertyName}") },
                    supportingContent = { Text("Balance ${formatKes(lease.balanceCents)}") },
                )
            }
        }
    }
}

/** Who is signed in, the org switch and sign out. */
@Composable
private fun AccountPane(account: Account, vm: SessionViewModel) {
    Column(Modifier.verticalScroll(rememberScrollState()).padding(vertical = 8.dp)) {
        ListItem(
            headlineContent = { Text(account.user.name) },
            supportingContent = { Text(account.user.phone ?: account.user.email.orEmpty()) },
        )
        if (account is Account.Staff && account.memberships.size > 1) {
            HorizontalDivider()
            Text("Organizations", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(16.dp))
            account.memberships.forEach { m ->
                val active = m.orgId == account.active.orgId
                ListItem(
                    headlineContent = { Text(m.orgName) },
                    supportingContent = { Text(ROLE_LABEL[m.role].orEmpty()) },
                    leadingContent = { RadioButton(selected = active, onClick = null) },
                    modifier = Modifier.selectable(selected = active, role = Role.RadioButton) {
                        if (!active) vm.switchOrg(m.orgId)
                    },
                )
            }
        }
        HorizontalDivider()
        OutlinedButton(onClick = { vm.signOut() }, modifier = Modifier.padding(16.dp).testTag("sign-out")) { Text("Sign out") }
    }
}

@Composable
fun NoAccessScreen(account: Account.NoAccess, webUrl: String?, onSignOut: () -> Unit) = Centered {
    Text("Welcome, ${account.user.name}", style = MaterialTheme.typography.headlineSmall)
    Text(
        "Your account isn't part of an organization yet. Set one up on the web app" +
            (webUrl?.let { " at $it" } ?: "") + ", or ask your landlord or manager for an invitation.",
        textAlign = TextAlign.Center,
    )
    OutlinedButton(onClick = onSignOut) { Text("Sign out") }
}
