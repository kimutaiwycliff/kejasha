package ke.kejasha.app.net

import ke.kejasha.app.session.TokenStore
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Sends the bearer token (ADR-004). A 401 on a signed-in request means the session ended on the
 * server (signed out elsewhere, expired); [unauthorized] tells the session to sign out locally.
 */
class AuthInterceptor(private val tokens: TokenStore) : Interceptor {
    private val _unauthorized = MutableSharedFlow<Unit>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val unauthorized: SharedFlow<Unit> = _unauthorized

    override fun intercept(chain: Interceptor.Chain): Response {
        val token = tokens.current ?: return chain.proceed(chain.request())
        val response = chain.proceed(chain.request().newBuilder().header("Authorization", "Bearer $token").build())
        if (response.code == 401) _unauthorized.tryEmit(Unit)
        return response
    }
}
