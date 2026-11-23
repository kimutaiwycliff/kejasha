package ke.kejasha.app.session

import ke.kejasha.api.endpoints.IdentityApi
import ke.kejasha.api.endpoints.PlatformApi
import ke.kejasha.api.endpoints.PortalApi
import ke.kejasha.api.models.AuthSession
import ke.kejasha.api.models.Me
import ke.kejasha.api.models.OtpRequestBodyInput
import ke.kejasha.api.models.OtpVerifyBodyInput
import ke.kejasha.api.models.SetActiveOrgBodyInput
import ke.kejasha.api.models.SignInEmailBodyInput
import ke.kejasha.app.BuildConfig
import ke.kejasha.app.net.ApiError
import ke.kejasha.app.net.ApiJson
import ke.kejasha.app.net.AuthInterceptor
import ke.kejasha.app.net.api
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

sealed interface SessionState {
    data object Loading : SessionState
    data object SignedOut : SessionState

    /** The API no longer supports this app version (`minAndroidVersionCode`). */
    data object UpdateRequired : SessionState

    /** Signed in, but the account could not be loaded and none is cached. */
    data class Failed(val message: String) : SessionState

    /** [offline] when [account] comes from the device cache because the API was unreachable. */
    data class Ready(val account: Account, val offline: Boolean = false) : SessionState
}

@Singleton
class SessionRepository @Inject constructor(
    private val identity: IdentityApi,
    private val portal: PortalApi,
    private val platform: PlatformApi,
    private val tokens: TokenStore,
    auth: AuthInterceptor,
) {
    private val scope = CoroutineScope(SupervisorJob())
    private val _state = MutableStateFlow<SessionState>(SessionState.Loading)
    val state: StateFlow<SessionState> = _state.asStateFlow()

    /** The web app's URL from `/v1/meta/config` (never a literal: ADR-016). */
    var webUrl: String? = null
        private set

    init {
        scope.launch { auth.unauthorized.collect { if (tokens.current != null) endLocally() } }
    }

    /** On launch: check the app is still supported, then restore the saved session. */
    suspend fun start() {
        _state.value = SessionState.Loading
        val config = runCatching { api { platform.getMetaConfig() } }.getOrNull()
        if (config != null) {
            webUrl = config.webUrl.toString()
            if (BuildConfig.VERSION_CODE < config.minAndroidVersionCode) {
                _state.value = SessionState.UpdateRequired
                return
            }
        }
        val stored = tokens.load()
        if (stored == null) {
            _state.value = SessionState.SignedOut
            return
        }
        refresh(cached = stored.profile)
    }

    suspend fun requestOtp(phone: String): Int =
        api { identity.requestPhoneOtp(OtpRequestBodyInput(phone)) }.expiresInSeconds

    suspend fun verifyOtp(phone: String, code: String) =
        signedIn(api { identity.verifyPhoneOtp(OtpVerifyBodyInput(phone, code)) })

    suspend fun signInEmail(email: String, password: String) =
        signedIn(api { identity.signInEmail(SignInEmailBodyInput(email, password)) })

    suspend fun switchOrg(orgId: UUID) {
        publish(account(api { identity.setActiveOrg(SetActiveOrgBodyInput(orgId)) }))
    }

    /** Reload the account (pull to refresh, retry after a failure). */
    suspend fun retry() {
        val stored = tokens.load() ?: return run { _state.value = SessionState.SignedOut }
        refresh(cached = stored.profile)
    }

    suspend fun signOut() {
        runCatching { api { identity.signOut() } }
        endLocally()
    }

    private suspend fun signedIn(session: AuthSession) {
        tokens.save(TokenStore.Stored(session.token, profile = null))
        refresh(cached = null)
    }

    private suspend fun refresh(cached: String?) {
        try {
            publish(account(api { identity.getMe() }))
        } catch (e: ApiError) {
            if (e.isUnauthorized) return endLocally()
            val offline = cached?.let { runCatching { ApiJson.decodeFromString(Account.serializer(), it) }.getOrNull() }
            _state.value = if (offline != null) SessionState.Ready(offline, offline = true) else SessionState.Failed(e.userMessage)
        }
    }

    private suspend fun account(me: Me): Account {
        // A member without an active org (first sign-in on this device): activate the first one.
        val current = if (me.activeOrg == null && me.memberships.isNotEmpty()) {
            api { identity.setActiveOrg(SetActiveOrgBodyInput(me.memberships.first().orgId)) }
        } else {
            me
        }
        val tenancies = if (current.memberships.isEmpty()) api { portal.portalMe() } else null
        return resolveAccount(current, tenancies)
    }

    private suspend fun publish(account: Account) {
        val token = tokens.current ?: return endLocally()
        tokens.save(TokenStore.Stored(token, ApiJson.encodeToString(Account.serializer(), account)))
        _state.value = SessionState.Ready(account)
    }

    private suspend fun endLocally() {
        tokens.clear()
        _state.value = SessionState.SignedOut
    }
}
