package ke.kejasha.app.net

import ke.kejasha.api.endpoints.PlatformApi
import ke.kejasha.api.models.UploadRequestInput
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton

/**
 * Files go straight to object storage: `POST /v1/uploads` returns a short-lived signed URL, the
 * bytes are PUT there, and the returned key is what records reference (`photoKeys`, `receiptKey`).
 */
@Singleton
class Uploader @Inject constructor(
    private val platform: PlatformApi,
    @Named(UPLOADS) private val http: OkHttpClient,
) {
    suspend fun upload(
        purpose: UploadRequestInput.Purpose,
        bytes: ByteArray,
        contentType: UploadRequestInput.ContentType = UploadRequestInput.ContentType.IMAGE_SLASH_JPEG,
    ): String {
        val ticket = api { platform.createUpload(UploadRequestInput(purpose, contentType, bytes.size)) }
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url(ticket.uploadUrl)
                .method(ticket.method, bytes.toRequestBody(ticket.headers.contentType.toMediaType()))
                .build()
            try {
                http.newCall(request).execute().use {
                    if (!it.isSuccessful) throw ApiError.Http(it.code, "upload_failed", "The photo could not be uploaded. Try again.", null)
                }
            } catch (e: IOException) {
                throw ApiError.Network(e)
            }
        }
        return ticket.key
    }

    companion object {
        /** An OkHttp client without the API's auth and idempotency interceptors. */
        const val UPLOADS = "uploads"
    }
}
