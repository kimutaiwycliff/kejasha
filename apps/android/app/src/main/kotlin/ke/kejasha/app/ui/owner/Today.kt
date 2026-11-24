package ke.kejasha.app.ui.owner

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.ListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import ke.kejasha.api.models.CashCollectionStatusInput
import ke.kejasha.api.models.MatchStatusInput
import ke.kejasha.api.endpoints.PaymentsApi
import ke.kejasha.api.endpoints.ReportingApi
import ke.kejasha.api.endpoints.ShortStayApi
import ke.kejasha.api.models.Booking
import ke.kejasha.api.models.BookingStatus
import ke.kejasha.api.models.OwnerDashboard
import ke.kejasha.app.net.ApiError
import ke.kejasha.app.net.api
import ke.kejasha.app.ui.common.Empty
import ke.kejasha.app.ui.common.LoadViewModel
import ke.kejasha.app.ui.common.LoadableScreen
import ke.kejasha.app.ui.common.Page
import ke.kejasha.app.ui.common.SectionTitle
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.graphics.Color
import ke.kejasha.app.ui.common.CountUp
import ke.kejasha.app.ui.common.MetricCard
import ke.kejasha.app.ui.common.PairedBars
import ke.kejasha.app.ui.common.Tone
import ke.kejasha.app.ui.theme.LocalStatusColors
import ke.kejasha.app.ui.common.clickableRow
import ke.kejasha.app.util.currentPeriod
import ke.kejasha.app.util.formatKes
import ke.kejasha.app.util.todayNairobi
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import javax.inject.Inject

data class Today(
    val dashboard: OwnerDashboard,
    /** Null when the role may not see payments (the counts are hidden). */
    val toMatch: Int?,
    val cashPending: Int?,
    val arrivals: List<Booking>,
    val departures: List<Booking>,
)

/** A count that a role may not be allowed to read: hidden instead of failing the screen. */
internal suspend fun <T> optional(block: suspend () -> T): T? =
    try { block() } catch (e: ApiError) { if (e is ApiError.Http && e.status == 403) null else throw e }

@HiltViewModel
class TodayViewModel @Inject constructor(
    private val reporting: ReportingApi,
    private val payments: PaymentsApi,
    private val stays: ShortStayApi,
) : LoadViewModel<Today>() {
    init { refresh() }

    override suspend fun load(): Today = coroutineScope {
        val today = todayNairobi()
        val dashboard = async { api { reporting.getOwnerDashboard(currentPeriod()) } }
        val toMatch = async { optional { api { payments.listPayments(limit = 100, status = MatchStatusInput.UNMATCHED) }.items.size } }
        val cash = async { optional { api { payments.listCashCollections(limit = 100, status = CashCollectionStatusInput.PENDING) }.items.size } }
        // Stays overlapping yesterday–tomorrow cover today's arrivals and departures.
        val around = async {
            optional { api { stays.listBookings(limit = 100, from = today.minusDays(1).toString(), to = today.plusDays(1).toString()) }.items }
                .orEmpty()
        }
        val day = today.toString()
        Today(
            dashboard = dashboard.await(),
            toMatch = toMatch.await(),
            cashPending = cash.await(),
            arrivals = around.await().filter { it.checkIn == day && it.status == BookingStatus.CONFIRMED },
            departures = around.await().filter { it.checkOut == day && it.status == BookingStatus.CHECKED_IN },
        )
    }
}

/** What needs attention today; the cards open the tab that deals with it. */
@Composable
fun TodayScreen(onMoney: () -> Unit, onStays: () -> Unit, onRepairs: () -> Unit, vm: TodayViewModel = hiltViewModel()) =
    LoadableScreen(vm) { t ->
        val d = t.dashboard
        val status = LocalStatusColors.current
        Page {
            // Only set when the view is limited to one landlord (an agency's client).
            d.landlordName?.let { Text(it, style = MaterialTheme.typography.titleMedium) }
            // Hero: the month's collections on the brand's forest green.
            Card(
                colors = CardDefaults.cardColors(containerColor = status.forest, contentColor = Color.White),
                onClick = onMoney,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Collected this month", style = MaterialTheme.typography.labelLarge, color = Color(0xFFB9D3C9))
                    CountUp(d.collectedCents, ::formatKes, MaterialTheme.typography.headlineMedium)
                    Text("Net ${formatKes(d.netCents)} after expenses", style = MaterialTheme.typography.bodySmall, color = Color(0xFFB9D3C9))
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                MetricCard(
                    "Arrears", d.arrearsCents, ::formatKes, Icons.Outlined.WarningAmber,
                    if (d.arrearsCents > 0) Tone.BAD else Tone.GOOD, Modifier.weight(1f), onClick = onMoney,
                )
                MetricCard(
                    "Open repairs", d.activeTickets.toLong(), { it.toString() }, Icons.Outlined.Build,
                    if (d.activeTickets > 0) Tone.MURRAM else Tone.GOOD, Modifier.weight(1f), onClick = onRepairs,
                )
            }
            if (t.toMatch != null || t.cashPending != null) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    t.toMatch?.let {
                        MetricCard("Payments to match", it.toLong(), { n -> count(n.toInt()) }, Icons.AutoMirrored.Outlined.ReceiptLong, if (it > 0) Tone.WARN else Tone.GOOD, Modifier.weight(1f), onClick = onMoney)
                    }
                    t.cashPending?.let {
                        MetricCard("Cash to confirm", it.toLong(), { n -> count(n.toInt()) }, Icons.Outlined.Payments, if (it > 0) Tone.WARN else Tone.GOOD, Modifier.weight(1f), onClick = onMoney)
                    }
                }
            }
            if (d.trend.isNotEmpty()) {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Last six months", style = MaterialTheme.typography.titleMedium)
                        PairedBars(
                            months = d.trend.map { Triple(monthShort(it.period), it.collectedCents, it.expensesCents) },
                            aLabel = "Collected",
                            bLabel = "Expenses",
                            a = MaterialTheme.colorScheme.primary,
                            b = MaterialTheme.colorScheme.secondary,
                            summary = d.trend.joinToString("; ") { "${monthShort(it.period)}: collected ${formatKes(it.collectedCents)}, expenses ${formatKes(it.expensesCents)}" },
                        )
                    }
                }
            }
            SectionTitle("Arriving today")
            if (t.arrivals.isEmpty()) Empty("No check-ins today.")
            t.arrivals.forEach { BookingLine(it, onStays) }
            SectionTitle("Leaving today")
            if (t.departures.isEmpty()) Empty("No check-outs today.")
            t.departures.forEach { BookingLine(it, onStays) }
        }
    }

private val monthFormat = java.time.format.DateTimeFormatter.ofPattern("MMM", java.util.Locale.ENGLISH)

/** "2026-11" → "Nov". */
private fun monthShort(period: String) = runCatching { java.time.YearMonth.parse(period).format(monthFormat) }.getOrDefault(period)

private fun count(n: Int) = if (n >= 100) "100+" else n.toString()

@Composable
private fun BookingLine(b: Booking, onClick: () -> Unit) {
    ListItem(
        headlineContent = { Text("${b.guestName ?: "Guest"} · ${b.unitCode}") },
        supportingContent = { Text("${b.propertyName} · ${b.nights} nights") },
        modifier = Modifier.fillMaxWidth().clickableRow(onClick),
    )
}
