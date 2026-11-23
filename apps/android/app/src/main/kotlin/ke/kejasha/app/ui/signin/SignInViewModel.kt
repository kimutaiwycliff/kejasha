package ke.kejasha.app.ui.signin

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import ke.kejasha.app.net.ApiError
import ke.kejasha.app.session.SessionRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SignInUi(
    val byEmail: Boolean = false,
    val phone: String = "",
    /** Set once a code was sent to [phone]. */
    val codeSent: Boolean = false,
    val code: String = "",
    val email: String = "",
    val password: String = "",
    val busy: Boolean = false,
    val error: String? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
)

@HiltViewModel
class SignInViewModel @Inject constructor(private val session: SessionRepository) : ViewModel() {
    private val _ui = MutableStateFlow(SignInUi())
    val ui: StateFlow<SignInUi> = _ui.asStateFlow()

    fun edit(change: SignInUi.() -> SignInUi) = _ui.update { it.change().copy(error = null, fieldErrors = emptyMap()) }

    fun sendCode() = run { session.requestOtp(_ui.value.phone.trim()); _ui.update { it.copy(codeSent = true, code = "") } }

    fun verify() = run { session.verifyOtp(_ui.value.phone.trim(), _ui.value.code.trim()) }

    fun signInEmail() = run { session.signInEmail(_ui.value.email.trim(), _ui.value.password) }

    /** Runs one action at a time; the session state moves the app on when sign-in succeeds. */
    private fun run(action: suspend () -> Unit) {
        if (_ui.value.busy) return
        _ui.update { it.copy(busy = true, error = null, fieldErrors = emptyMap()) }
        viewModelScope.launch {
            try {
                action()
                _ui.update { it.copy(busy = false) }
            } catch (e: ApiError) {
                val fields = (e as? ApiError.Http)?.fieldErrors.orEmpty()
                _ui.update { it.copy(busy = false, error = if (fields.isEmpty()) e.userMessage else null, fieldErrors = fields) }
            }
        }
    }
}
