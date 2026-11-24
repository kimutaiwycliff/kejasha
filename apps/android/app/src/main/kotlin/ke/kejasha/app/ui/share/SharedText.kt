package ke.kejasha.app.ui.share

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Text shared into the app (an M-Pesa SMS from the messages app, ADR-009). Kept until a signed-in
 * owner, manager or agent opens it; the app never reads SMS itself.
 */
@Singleton
class SharedText @Inject constructor() {
    private val _text = MutableStateFlow<String?>(null)
    val text: StateFlow<String?> = _text.asStateFlow()

    fun receive(text: String?) {
        text?.trim()?.takeIf { it.length >= 10 }?.let { _text.value = it.take(1000) }
    }

    fun take(): String? = _text.value.also { _text.value = null }
}

/** Lets the shells see shared text: owners open it, other roles are told why it was not used. */
@dagger.hilt.android.lifecycle.HiltViewModel
class SharedTextViewModel @Inject constructor(private val shared: SharedText) : androidx.lifecycle.ViewModel() {
    val text: StateFlow<String?> = shared.text
    fun discard() { shared.take() }
}
