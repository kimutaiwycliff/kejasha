package ke.kejasha.app.ui.share

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import ke.kejasha.api.endpoints.PaymentsApi
import ke.kejasha.api.models.MatchStatus
import ke.kejasha.api.models.Payment
import ke.kejasha.api.models.SmsPaymentBodyInput
import ke.kejasha.app.net.ApiError
import ke.kejasha.app.net.api
import ke.kejasha.app.ui.common.Empty
import ke.kejasha.app.ui.common.Page
import ke.kejasha.app.ui.common.Row2
import ke.kejasha.app.ui.common.StatusChip
import ke.kejasha.app.ui.common.Tone
import ke.kejasha.app.util.SmsPreview
import ke.kejasha.app.util.formatKes
import ke.kejasha.app.util.previewMpesaSms
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

data class SmsUi(val text: String?, val preview: SmsPreview?, val busy: Boolean = false, val added: Payment? = null, val error: String? = null)

@HiltViewModel
class SmsPaymentViewModel @Inject constructor(shared: SharedText, private val payments: PaymentsApi) : ViewModel() {
    private val text = shared.take()
    private val _ui = MutableStateFlow(SmsUi(text, text?.let(::previewMpesaSms)))
    val ui: StateFlow<SmsUi> = _ui.asStateFlow()

    fun add() {
        val t = text ?: return
        if (_ui.value.busy) return
        _ui.value = _ui.value.copy(busy = true, error = null)
        viewModelScope.launch {
            _ui.value = try {
                _ui.value.copy(busy = false, added = api { payments.recordPaymentFromSms(SmsPaymentBodyInput(t)) })
            } catch (e: ApiError) {
                _ui.value.copy(busy = false, error = e.userMessage)
            }
        }
    }
}

/** A shared M-Pesa SMS: preview, add, then matched to a tenant or waiting in "to match". */
@Composable
fun SmsPaymentScreen(onMatch: (UUID) -> Unit, onDone: () -> Unit, vm: SmsPaymentViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    Page {
        val added = ui.added
        if (added != null) {
            Text(formatKes(added.amountCents), style = MaterialTheme.typography.headlineMedium)
            if (added.matchStatus == MatchStatus.MATCHED) {
                StatusChip("Matched", Tone.GOOD)
                Text("Credited to ${added.tenantName ?: "the tenant"} · ${added.unitCode.orEmpty()}. A receipt is sent.")
                Button(onClick = onDone, modifier = Modifier.fillMaxWidth()) { Text("Done") }
            } else {
                StatusChip("Waiting to be matched", Tone.WARN)
                Text("Added to Payments to match.")
                Button(onClick = { onMatch(added.id) }, modifier = Modifier.fillMaxWidth().testTag("match-now")) { Text("Match it now") }
                OutlinedButton(onClick = onDone, modifier = Modifier.fillMaxWidth()) { Text("Later") }
            }
            return@Page
        }
        when (val p = ui.preview) {
            null -> Empty("Nothing was shared. In your messages app, share an M-Pesa SMS with Kejasha.")
            SmsPreview.Outgoing -> Empty("This SMS is for money leaving the account, so it is not added as a payment.")
            SmsPreview.NotRecognised -> Empty("This does not look like an M-Pesa payment confirmation.")
            is SmsPreview.Incoming -> {
                Text(formatKes(p.amountCents), style = MaterialTheme.typography.headlineMedium)
                Row2("From", p.from)
                Row2("M-Pesa code", p.code)
                Row2("Paid", p.paidOn)
                p.accountRef?.let { Row2("Account number", it) }
                Button(onClick = vm::add, enabled = !ui.busy, modifier = Modifier.fillMaxWidth().testTag("add-sms-payment")) { Text("Add payment") }
                Text("It goes to your payments and is matched to a tenant when the account number or phone fits.", style = MaterialTheme.typography.bodySmall)
            }
        }
        ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        ui.text?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}
