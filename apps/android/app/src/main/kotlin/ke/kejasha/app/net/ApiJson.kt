package ke.kejasha.app.net

import ke.kejasha.api.infrastructure.Serializer
import kotlinx.serialization.json.Json

/**
 * JSON for the API. Absent optional fields are left out of request bodies (Zod `.optional()`
 * rejects `null`); unknown response fields are ignored so additive contract changes are safe.
 */
val ApiJson: Json = Json {
    serializersModule = Serializer.kotlinxSerializationAdapters
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
}
