package ke.kejasha.api.support

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The `Accepted` response (`{ "ok": true }`, HTTP 202). The contract declares `ok` as the
 * constant `true`, which the Kotlin generator turns into an enum it cannot compile, so the
 * generator maps the schema here instead (`schemaMappings` in build.gradle.kts).
 */
@Serializable
data class Accepted(@SerialName("ok") val ok: Boolean)
