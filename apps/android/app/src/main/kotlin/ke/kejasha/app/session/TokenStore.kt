package ke.kejasha.app.session

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.first
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.inject.Inject
import javax.inject.Singleton

/** The signed-in session on this device: the bearer token and the last known profile. */
interface TokenStore {
    /** The token in memory, for the network layer (read on OkHttp threads). */
    val current: String?
    suspend fun load(): Stored?
    suspend fun save(stored: Stored)
    suspend fun clear()

    /** [profile] is the cached account JSON, so the app opens offline. */
    data class Stored(val token: String, val profile: String?)
}

private val Context.authStore by preferencesDataStore("auth")

/** DataStore values encrypted with an AES-GCM key held in the Android Keystore. */
@Singleton
class KeystoreTokenStore @Inject constructor(@ApplicationContext private val context: Context) : TokenStore {
    @Volatile override var current: String? = null
        private set

    override suspend fun load(): TokenStore.Stored? {
        val prefs = context.authStore.data.first()
        val token = prefs[TOKEN]?.let(::decrypt)
        if (token == null) {
            // Missing, or unreadable because the key is gone (app data restored to a new device).
            clear()
            return null
        }
        current = token
        return TokenStore.Stored(token, prefs[PROFILE]?.let(::decrypt))
    }

    override suspend fun save(stored: TokenStore.Stored) {
        context.authStore.edit {
            it[TOKEN] = encrypt(stored.token)
            if (stored.profile != null) it[PROFILE] = encrypt(stored.profile) else it.remove(PROFILE)
        }
        current = stored.token
    }

    override suspend fun clear() {
        current = null
        context.authStore.edit { it.clear() }
    }

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getKey(ALIAS, null) as SecretKey?)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).apply {
            init(
                KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build(),
            )
        }.generateKey()
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
        return Base64.encodeToString(cipher.iv + cipher.doFinal(plain.toByteArray()), Base64.NO_WRAP)
    }

    private fun decrypt(encoded: String): String? = runCatching {
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION).apply {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, IV_BYTES))
        }
        String(cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES))
    }.getOrNull()

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "kejasha-session"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
        val TOKEN = stringPreferencesKey("token")
        val PROFILE = stringPreferencesKey("profile")
    }
}

@Module
@InstallIn(SingletonComponent::class)
interface TokenStoreModule {
    @Binds fun tokenStore(impl: KeystoreTokenStore): TokenStore
}
