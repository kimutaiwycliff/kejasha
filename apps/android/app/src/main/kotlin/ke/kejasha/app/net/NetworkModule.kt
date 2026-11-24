package ke.kejasha.app.net

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import ke.kejasha.api.endpoints.IdentityApi
import ke.kejasha.api.endpoints.LeasingApi
import ke.kejasha.api.endpoints.MaintenanceApi
import ke.kejasha.api.endpoints.PaymentsApi
import ke.kejasha.api.endpoints.PlatformApi
import ke.kejasha.api.endpoints.PortalApi
import ke.kejasha.api.endpoints.ReportingApi
import ke.kejasha.api.endpoints.ShortStayApi
import ke.kejasha.api.endpoints.SyncApi
import ke.kejasha.app.BuildConfig
import ke.kejasha.app.session.TokenStore
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.converter.scalars.ScalarsConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Named
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

    @Provides @Singleton @Named(Uploader.UPLOADS)
    fun uploadsHttp(): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    @Provides @Singleton
    fun retrofit(client: OkHttpClient): Retrofit = buildRetrofit(BuildConfig.API_URL, client)

    /** Also used by tests against MockWebServer. */
    fun buildRetrofit(baseUrl: String, client: OkHttpClient): Retrofit = Retrofit.Builder()
        .baseUrl(baseUrl.trimEnd('/') + "/")
        .client(client)
        .addConverterFactory(EnumQueryConverterFactory)
        .addConverterFactory(ScalarsConverterFactory.create())
        .addConverterFactory(ApiJson.asConverterFactory("application/json".toMediaType()))
        .build()

    @Provides @Singleton fun identityApi(r: Retrofit): IdentityApi = r.create(IdentityApi::class.java)
    @Provides @Singleton fun platformApi(r: Retrofit): PlatformApi = r.create(PlatformApi::class.java)
    @Provides @Singleton fun portalApi(r: Retrofit): PortalApi = r.create(PortalApi::class.java)
    @Provides @Singleton fun paymentsApi(r: Retrofit): PaymentsApi = r.create(PaymentsApi::class.java)
    @Provides @Singleton fun reportingApi(r: Retrofit): ReportingApi = r.create(ReportingApi::class.java)
    @Provides @Singleton fun maintenanceApi(r: Retrofit): MaintenanceApi = r.create(MaintenanceApi::class.java)
    @Provides @Singleton fun shortStayApi(r: Retrofit): ShortStayApi = r.create(ShortStayApi::class.java)
    @Provides @Singleton fun leasingApi(r: Retrofit): LeasingApi = r.create(LeasingApi::class.java)
    @Provides @Singleton fun syncApi(r: Retrofit): SyncApi = r.create(SyncApi::class.java)
}
