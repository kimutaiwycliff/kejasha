package ke.kejasha.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import ke.kejasha.api.models.Invitation
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
    private val _confirmSignOut = MutableStateFlow(0)
    /** Above zero: that many offline changes would be lost; ask before signing out. */
    val confirmSignOut: StateFlow<Int> = _confirmSignOut.asStateFlow()

    fun signOut(force: Boolean = false) = viewModelScope.launch {
        val unsynced = session.unsynced()
        if (unsynced > 0 && !force) {
            _confirmSignOut.value = unsynced
            return@launch
        }
        _confirmSignOut.value = 0
        session.signOut()
    }

    fun keepSignedIn() { _confirmSignOut.value = 0 }

    private val _invitations = MutableStateFlow<List<Invitation>?>(null)
    /** Pending invitations for someone signed in without an organization. */
    val invitations: StateFlow<List<Invitation>?> = _invitations.asStateFlow()

    fun loadInvitations() = viewModelScope.launch {
        _invitations.value = try { session.invitations() } catch (e: ApiError) { _message.value = e.userMessage; emptyList() }
    }

    fun accept(id: UUID) = viewModelScope.launch {
        try {
            session.acceptInvitation(id)
        } catch (e: ApiError) {
            _message.value = e.userMessage
        }
    }
    fun switchOrg(orgId: UUID) = viewModelScope.launch {
        try {
            session.switchOrg(orgId)
        } catch (e: ApiError) {
            _message.value = e.userMessage
        }
    }
    fun messageShown() { _message.value = null }

    /** A one-line notice in the shell's snackbar. */
    fun say(text: String) { _message.value = text }
}
