package ke.kejasha.app.net

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import ke.kejasha.api.endpoints.IdentityApi
import ke.kejasha.api.endpoints.PlatformApi
import ke.kejasha.api.endpoints.PortalApi
import ke.kejasha.app.BuildConfig
import ke.kejasha.app.session.TokenStore
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.converter.scalars.ScalarsConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides @Singleton
    fun authInterceptor(tokens: TokenStore) = AuthInterceptor(tokens)

    @Provides @Singleton
    fun okHttp(auth: AuthInterceptor): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            chain.proceed(
                chain.request().newBuilder()
                    .header("Accept", "application/json")
                    .header("User-Agent", "Kejasha-Android/${BuildConfig.VERSION_NAME}")
                    .build(),
            )
        }
        // Auth first: the idempotency fingerprint includes the caller.
        .addInterceptor(auth)
        .addInterceptor(IdempotencyInterceptor())
        .apply {
            if (BuildConfig.DEBUG) {
                addInterceptor(
                    HttpLoggingInterceptor().apply {
                        level = HttpLoggingInterceptor.Level.BASIC
                        redactHeader("Authorization")
                    },
                )
            }
        }
        .build()

    @Provides @Singleton
    fun retrofit(client: OkHttpClient): Retrofit = Retrofit.Builder()
        .baseUrl(BuildConfig.API_URL.trimEnd('/') + "/")
        .client(client)
        .addConverterFactory(ScalarsConverterFactory.create())
        .addConverterFactory(ApiJson.asConverterFactory("application/json".toMediaType()))
        .build()

    @Provides @Singleton fun identityApi(r: Retrofit): IdentityApi = r.create(IdentityApi::class.java)
    @Provides @Singleton fun platformApi(r: Retrofit): PlatformApi = r.create(PlatformApi::class.java)
    @Provides @Singleton fun portalApi(r: Retrofit): PortalApi = r.create(PortalApi::class.java)
}
