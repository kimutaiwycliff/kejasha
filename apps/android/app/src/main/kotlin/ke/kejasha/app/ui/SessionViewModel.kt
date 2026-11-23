package ke.kejasha.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import ke.kejasha.app.net.ApiError
import ke.kejasha.app.session.SessionRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

@HiltViewModel
class SessionViewModel @Inject constructor(private val session: SessionRepository) : ViewModel() {
    val state = session.state
    val webUrl: String? get() = session.webUrl

    private val _message = MutableStateFlow<String?>(null)
    /** A one-line error from an org switch, shown as a snackbar. */
    val message: StateFlow<String?> = _message.asStateFlow()

    init {
        viewModelScope.launch { session.start() }
    }

    fun retry() = viewModelScope.launch { session.retry() }
    fun signOut() = viewModelScope.launch { session.signOut() }
    fun switchOrg(orgId: UUID) = viewModelScope.launch {
        try {
            session.switchOrg(orgId)
        } catch (e: ApiError) {
            _message.value = e.userMessage
        }
    }
    fun messageShown() { _message.value = null }
}
