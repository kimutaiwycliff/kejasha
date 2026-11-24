package ke.kejasha.app.ui.common

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ke.kejasha.app.net.ApiError
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface Loadable<out T> {
    data object Loading : Loadable<Nothing>
    data class Failed(val message: String) : Loadable<Nothing>
    data class Ready<T>(val data: T) : Loadable<T>
}

/**
 * A screen that loads data from the API, refreshes it, and runs actions against it. Subclasses
 * call [refresh] from `init`. Actions show their outcome as a one-line [message].
 */
abstract class LoadViewModel<T> : ViewModel() {
    private val _state = MutableStateFlow<Loadable<T>>(Loadable.Loading)
    val state: StateFlow<Loadable<T>> = _state.asStateFlow()

    private val _refreshing = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = _refreshing.asStateFlow()

    private val _busy = MutableStateFlow(false)
    /** An action is running: disable buttons. */
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    protected abstract suspend fun load(): T

    fun refresh() {
        viewModelScope.launch {
            _refreshing.value = true
            try {
                _state.value = Loadable.Ready(load())
            } catch (e: ApiError) {
                // Keep what is on screen when a refresh fails; say why instead.
                if (_state.value is Loadable.Ready) _message.value = e.userMessage else _state.value = Loadable.Failed(e.userMessage)
            } finally {
                _refreshing.value = false
            }
        }
    }

    /** Runs one action at a time; on success shows [success], reloads, then calls [then]. */
    protected fun act(success: String?, then: () -> Unit = {}, block: suspend () -> Any?) {
        if (_busy.value) return
        _busy.value = true
        viewModelScope.launch {
            try {
                block()
                _message.value = success
                refresh()
                then()
            } catch (e: ApiError) {
                _message.value = e.userMessage
            } finally {
                _busy.value = false
            }
        }
    }

    protected fun say(message: String) { _message.value = message }

    fun messageShown() { _message.value = null }
}
