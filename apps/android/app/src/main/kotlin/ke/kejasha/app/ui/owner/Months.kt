package ke.kejasha.app.ui.owner

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import ke.kejasha.api.endpoints.ReportingApi
import ke.kejasha.api.models.OwnerDashboard
import ke.kejasha.app.net.api
import ke.kejasha.app.ui.common.Empty
import ke.kejasha.app.ui.common.LoadViewModel
import ke.kejasha.app.ui.common.LoadableScreen
import ke.kejasha.app.ui.common.Page
import ke.kejasha.app.ui.common.Row2
import ke.kejasha.app.util.currentPeriod
import ke.kejasha.app.util.formatKes
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale
import javax.inject.Inject

@HiltViewModel
class MonthsViewModel @Inject constructor(private val reporting: ReportingApi) : LoadViewModel<OwnerDashboard>() {
    init { refresh() }
    override suspend fun load() = api { reporting.getOwnerDashboard(currentPeriod()) }
}

private val monthName = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.ENGLISH)

/** Month by month: collected, expenses and net (read-only owners, e.g. abroad). PDFs are on the web. */
@Composable
fun MonthsScreen(vm: MonthsViewModel = hiltViewModel()) = LoadableScreen(vm) { d ->
    Page {
        Text("${d.landlordName} · monthly summary", style = MaterialTheme.typography.titleMedium)
        if (d.trend.isEmpty()) Empty("No months to show yet.")
        d.trend.sortedByDescending { it.period }.forEach { m ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(runCatching { YearMonth.parse(m.period).format(monthName) }.getOrDefault(m.period), style = MaterialTheme.typography.titleMedium)
                    Row2("Collected", formatKes(m.collectedCents))
                    Row2("Expenses", formatKes(m.expensesCents))
                    Row2("Net", formatKes(m.netCents))
                }
            }
        }
        Text("Monthly PDF statements are on the web app.", style = MaterialTheme.typography.bodySmall)
    }
}
