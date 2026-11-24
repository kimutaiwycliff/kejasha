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
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.selection.selectable
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.IconButton
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.key
import androidx.navigation.NavDestination
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import ke.kejasha.app.ui.caretaker.CaretakerRepairsScreen
import ke.kejasha.app.ui.caretaker.CashScreen
import ke.kejasha.app.ui.caretaker.LocalTicketScreen
import ke.kejasha.app.ui.caretaker.LogCashScreen
import ke.kejasha.app.ui.caretaker.ReportTicketScreen
import ke.kejasha.app.ui.caretaker.RoundScreen
import ke.kejasha.app.ui.caretaker.SyncScreen
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.layout.Row
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.MapsHomeWork
import androidx.compose.ui.Alignment
import ke.kejasha.app.ui.common.ConfirmDialog
import ke.kejasha.app.ui.common.KejashaMark
import ke.kejasha.app.ui.homes.HomesScreen
import ke.kejasha.app.ui.homes.LocationPickerScreen
import ke.kejasha.app.ui.homes.PropertyScreen
import ke.kejasha.app.ui.share.SharedTextViewModel
import ke.kejasha.app.ui.share.SmsPaymentScreen
import ke.kejasha.app.ui.tenant.TenantHomeScreen
import ke.kejasha.app.ui.tenant.TenantPayScreen
import ke.kejasha.app.ui.tenant.TenantRepairsScreen
import ke.kejasha.app.ui.tenant.TenantStatementScreen
import androidx.compose.runtime.rememberCoroutineScope
import ke.kejasha.app.ui.common.LocalNotifier
import ke.kejasha.app.ui.common.Notifier
import ke.kejasha.app.ui.owner.MoneyScreen
import ke.kejasha.app.ui.owner.MonthsScreen
import ke.kejasha.app.ui.owner.PaymentMatchScreen
import ke.kejasha.app.ui.owner.RequestPaymentScreen
import ke.kejasha.app.ui.owner.StaysScreen
import ke.kejasha.app.ui.owner.TodayScreen
import ke.kejasha.app.ui.repairs.RepairsScreen
import ke.kejasha.app.ui.repairs.TicketScreen
import ke.kejasha.api.models.Role as MemberRole
import ke.kejasha.app.session.Account
import ke.kejasha.app.session.Shell
import ke.kejasha.app.ui.Centered
import ke.kejasha.app.ui.SessionViewModel

private class Tab(val name: String, val label: String, val icon: ImageVector)

private val ROLE_LABEL = mapOf(
    MemberRole.OWNER to "Owner",
    MemberRole.MANAGER to "Manager",
    MemberRole.AGENT to "Agent",
    MemberRole.CARETAKER to "Caretaker",
    MemberRole.VIEWER to "Viewer",
)

private val TODAY = Tab("today", "Today", Icons.Outlined.Today)
private val MONEY = Tab("money", "Money", Icons.Outlined.Payments)
private val STAYS = Tab("stays", "Stays", Icons.Outlined.CalendarMonth)
private val REPAIRS = Tab("repairs", "Repairs", Icons.Outlined.Build)
private val MORE = Tab("more", "More", Icons.Outlined.Menu)
private val ROUND = Tab("round", "Round", Icons.Outlined.Speed)
private val CASH = Tab("cash", "Cash", Icons.Outlined.Payments)
private val SYNC = Tab("sync", "Sync", Icons.Outlined.Sync)
private val MONTHS = Tab("months", "Months", Icons.AutoMirrored.Outlined.ReceiptLong)
private val HOMES = Tab("homes", "Homes", Icons.Outlined.MapsHomeWork)
private val HOME = Tab("home", "Home", Icons.Outlined.Home)
private val STATEMENT = Tab("statement", "Statement", Icons.AutoMirrored.Outlined.ReceiptLong)

/** Owner/manager/agent, caretaker and viewer shells: the tabs follow the role in the active org. */
@Composable
fun StaffShell(account: Account.Staff, offline: Boolean, vm: SessionViewModel) {
    val tabs = when (account.shell) {
        Shell.OWNER -> listOf(TODAY, MONEY, HOMES, STAYS, REPAIRS)
        Shell.CARETAKER -> listOf(ROUND, REPAIRS, CASH, SYNC, MORE)
        Shell.VIEWER -> listOf(TODAY, HOMES, MONTHS, MORE)
    }
    val shared: SharedTextViewModel = hiltViewModel()
    val sharedText by shared.text.collectAsStateWithLifecycle()
    val canAddPayments = account.shell == Shell.OWNER
    LaunchedEffect(sharedText, canAddPayments) {
        if (sharedText != null && !canAddPayments) {
            shared.discard()
            vm.say("Only owners, managers and agents can add M-Pesa payments.")
        }
    }
    // A new org (and so maybe a new shell) starts a fresh navigation graph.
    key(account.active.orgId) {
        val canEdit = account.active.role == MemberRole.OWNER || account.active.role == MemberRole.MANAGER
        ShellScaffold(
            account.active.orgName,
            offline,
            tabs,
            vm,
            incoming = SmsPaymentRoute.takeIf { canAddPayments && sharedText != null },
            // Owners have five working tabs; their account opens from the top bar.
            accountInTopBar = account.shell == Shell.OWNER,
            canEditProperties = canEdit,
            account = { AccountPane(account, vm) },
        ) { name, nav ->
            when (name) {
                "today" -> TodayScreen(
                    onMoney = { nav.tab("money") },
                    onStays = { nav.tab("stays") },
                    onRepairs = { nav.tab("repairs") },
                )
                "money" -> MoneyScreen(
                    onPayment = { nav.open(PaymentRoute(it.toString())) },
                    onRequestPayment = { nav.open(RequestPaymentRoute()) },
                )
                "stays" -> StaysScreen(onRequestPayment = { nav.open(RequestPaymentRoute(bookingId = it.toString())) })
                "repairs" -> if (account.shell == Shell.CARETAKER) {
                    CaretakerRepairsScreen(onReport = { nav.open(ReportTicketRoute) }, onTicket = { nav.open(LocalTicketRoute(it)) })
                } else {
                    RepairsScreen(onTicket = { nav.open(TicketRoute(it.toString())) })
                }
                "round" -> RoundScreen()
                "cash" -> CashScreen(onLog = { nav.open(LogCashRoute) })
                "sync" -> SyncScreen()
                "months" -> MonthsScreen()
                "homes" -> HomesScreen(onProperty = { nav.open(PropertyRoute(it.toString())) })
                else -> AccountPane(account, vm)
            }
        }
    }
}

/** Tenant portal: balances and pay (A3) across every landlord that holds this phone. */
@Composable
fun TenantShell(account: Account.Tenant, offline: Boolean, vm: SessionViewModel) {
    val shared: SharedTextViewModel = hiltViewModel()
    val sharedText by shared.text.collectAsStateWithLifecycle()
    LaunchedEffect(sharedText) {
        if (sharedText != null) {
            shared.discard()
            vm.say("M-Pesa messages are added by your landlord. Pay from Home instead.")
        }
    }
    ShellScaffold("My home", offline, listOf(HOME, STATEMENT, REPAIRS, MORE), vm) { name, nav ->
        when (name) {
            "home" -> TenantHomeScreen(account.user.name, onPay = { nav.open(TenantPayRoute(it.toString())) })
            "statement" -> TenantStatementScreen()
            "repairs" -> TenantRepairsScreen()
            else -> AccountPane(account, vm)
        }
    }
}

/** Moves between tabs and opens detail screens. */
class ShellNav(private val controller: NavHostController) {
    fun tab(name: String) = controller.navigate(tabRoute(name)) {
        popUpTo(controller.graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }

    fun open(route: Any) = controller.navigate(route)

    fun back() = controller.popBackStack()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ShellScaffold(
    title: String,
    offline: Boolean,
    tabs: List<Tab>,
    vm: SessionViewModel,
    /** A screen to open as soon as the shell is shown (e.g. a shared SMS). */
    incoming: Any? = null,
    /** Owners: an account button in the top bar instead of a "More" tab. */
    accountInTopBar: Boolean = false,
    canEditProperties: Boolean = false,
    account: @Composable () -> Unit = {},
    tabContent: @Composable (name: String, nav: ShellNav) -> Unit,
) {
    val controller = rememberNavController()
    val nav = remember(controller) { ShellNav(controller) }
    LaunchedEffect(incoming) { incoming?.let(nav::open) }
    val entry by controller.currentBackStackEntryAsState()
    val destination = entry?.destination
    val onTab = destination?.route?.startsWith(tabRoute("")) != false
    val current = destination?.route?.takeIf { onTab }?.removePrefix(tabRoute("")) ?: tabs.first().name
    val snackbar = remember { SnackbarHostState() }
    val message by vm.message.collectAsStateWithLifecycle()
    LaunchedEffect(message) {
        message?.let { snackbar.showSnackbar(it); vm.messageShown() }
    }
    val scope = rememberCoroutineScope()
    val notifier = remember(snackbar, scope) { Notifier(snackbar, scope) }
    CompositionLocalProvider(LocalNotifier provides notifier) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        if (onTab) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                KejashaMark(28.dp)
                                Text(title, maxLines = 1)
                            }
                        } else {
                            Text(detailTitle(destination))
                        }
                    },
                    navigationIcon = {
                        if (!onTab) {
                            IconButton(onClick = { nav.back() }) {
                                Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back")
                            }
                        }
                    },
                    actions = {
                        if (onTab && accountInTopBar) {
                            IconButton(onClick = { nav.open(AccountRoute) }, modifier = Modifier.testTag("account")) {
                                Icon(Icons.Outlined.AccountCircle, contentDescription = "Account")
                            }
                        }
                    },
                )
            },
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                if (onTab) {
                    NavigationBar {
                        tabs.forEach { tab ->
                            NavigationBarItem(
                                selected = tab.name == current,
                                onClick = { nav.tab(tab.name) },
                                icon = { Icon(tab.icon, contentDescription = null) },
                                label = { Text(tab.label) },
                                modifier = Modifier.testTag("tab-${tab.name}"),
                            )
                        }
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
                NavHost(
                    controller,
                    startDestination = tabRoute(tabs.first().name),
                    modifier = Modifier.fillMaxSize(),
                    // Gentle motion: detail screens slide in a little; tabs cross-fade.
                    enterTransition = { fadeIn(tween(220)) + slideInHorizontally(tween(220)) { it / 10 } },
                    exitTransition = { fadeOut(tween(160)) },
                    popEnterTransition = { fadeIn(tween(220)) },
                    popExitTransition = { fadeOut(tween(160)) + slideOutHorizontally(tween(220)) { it / 10 } },
                ) {
                    tabs.forEach { tab -> composable(tabRoute(tab.name)) { tabContent(tab.name, nav) } }
                    composable<PaymentRoute> { PaymentMatchScreen(onDone = { nav.back() }) }
                    composable<RequestPaymentRoute> { RequestPaymentScreen(onDone = { nav.back() }) }
                    composable<TicketRoute> { TicketScreen() }
                    composable<LocalTicketRoute> { LocalTicketScreen() }
                    composable<ReportTicketRoute> { ReportTicketScreen(onDone = { nav.back() }) }
                    composable<LogCashRoute> { LogCashScreen(onDone = { nav.back() }) }
                    composable<TenantPayRoute> { TenantPayScreen(onDone = { nav.back() }) }
                    composable<PropertyRoute> {
                        PropertyScreen(canEdit = canEditProperties, onSetLocation = { nav.open(LocationRoute(it.toString())) })
                    }
                    composable<LocationRoute> { LocationPickerScreen(onDone = { nav.back() }) }
                    composable<AccountRoute> { account() }
                    composable<SmsPaymentRoute> {
                        SmsPaymentScreen(onMatch = { nav.back(); nav.open(PaymentRoute(it.toString())) }, onDone = { nav.back() })
                    }
                }
            }
        }
    }
}

private fun detailTitle(destination: NavDestination?): String = when {
    destination == null -> ""
    destination.hasRoute(PaymentRoute::class) -> "Match payment"
    destination.hasRoute(RequestPaymentRoute::class) -> "Request payment"
    destination.hasRoute(TicketRoute::class) || destination.hasRoute(LocalTicketRoute::class) -> "Repair"
    destination.hasRoute(ReportTicketRoute::class) -> "Report a problem"
    destination.hasRoute(LogCashRoute::class) -> "Log cash"
    destination.hasRoute(TenantPayRoute::class) -> "Pay rent"
    destination.hasRoute(SmsPaymentRoute::class) -> "Add M-Pesa payment"
    destination.hasRoute(PropertyRoute::class) -> "Property"
    destination.hasRoute(LocationRoute::class) -> "Set location"
    destination.hasRoute(AccountRoute::class) -> "Account"
    else -> ""
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
    val unsynced by vm.confirmSignOut.collectAsStateWithLifecycle()
    if (unsynced > 0) {
        ConfirmDialog(
            title = "Sign out and lose $unsynced unsent ${if (unsynced == 1) "change" else "changes"}?",
            text = "They have not reached Kejasha yet. Connect to the internet and sync first to keep them.",
            confirmLabel = "Sign out anyway",
            onDismiss = vm::keepSignedIn,
            onConfirm = { vm.signOut(force = true) },
        )
    }
}

/** Signed in without an organization: accept an invitation, or set one up on the web. */
@Composable
fun NoAccessScreen(account: Account.NoAccess, vm: SessionViewModel) {
    val invitations by vm.invitations.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.loadInvitations() }
    Centered {
        Text("Welcome, ${account.user.name}", style = MaterialTheme.typography.headlineSmall)
        val pending = invitations
        when {
            pending == null -> CircularProgressIndicator()
            pending.isNotEmpty() -> pending.forEach { inv ->
                Text("${inv.orgName} invited you as ${ROLE_LABEL[inv.role].orEmpty().lowercase()}.", textAlign = TextAlign.Center)
                Button(onClick = { vm.accept(inv.id) }, modifier = Modifier.testTag("accept-invitation")) { Text("Join ${inv.orgName}") }
            }
            else -> Text(
                "Your account isn't part of an organization yet. Set one up on the web app" +
                    (vm.webUrl?.let { " at $it" } ?: "") + ", or ask your landlord or manager for an invitation.",
                textAlign = TextAlign.Center,
            )
        }
        message?.let { Text(it, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center) }
        OutlinedButton(onClick = { vm.loadInvitations() }) { Text("Check again") }
        OutlinedButton(onClick = { vm.signOut() }) { Text("Sign out") }
    }
}
