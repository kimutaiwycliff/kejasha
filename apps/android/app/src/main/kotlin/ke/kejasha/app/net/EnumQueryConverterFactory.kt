package ke.kejasha.app.net

import kotlinx.serialization.SerialName
import retrofit2.Converter
import retrofit2.Retrofit
import java.lang.reflect.Type

/**
 * Sends enum query parameters as their wire value (`@SerialName`), not the Kotlin constant name:
 * some generated enums do not override `toString()` (e.g. `active=true`, not `TRUE`).
 */
object EnumQueryConverterFactory : Converter.Factory() {
    override fun stringConverter(type: Type, annotations: Array<out Annotation>, retrofit: Retrofit): Converter<*, String>? {
        val cls = type as? Class<*> ?: return null
        if (!cls.isEnum) return null
        return Converter<Enum<*>, String> { value -> wireName(value) }
    }

    fun wireName(value: Enum<*>): String =
        value.javaClass.getField(value.name).getAnnotation(SerialName::class.java)?.value ?: value.toString()
}
