// Generated from apps/api/openapi.json at build time (ADR-017). Never edit the output by hand.
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.openapi.generator)
}

val spec = rootProject.layout.projectDirectory.file("../api/openapi.json")
val generatedDir = layout.buildDirectory.dir("generated/openapi")
val normalizedSpec = layout.buildDirectory.file("openapi/openapi.normalized.json")

/**
 * openapi-generator 7.14 turns OpenAPI 3.1 `anyOf: [<primitive>, {type: null}]` into an empty
 * class that cannot decode the value (e.g. a lease id). The equivalent `type: [<type>, "null"]`
 * generates a plain nullable property, so the spec is rewritten that way before generation.
 */
val normalizeSpec by tasks.registering {
    val source = spec.asFile
    val target = normalizedSpec
    inputs.file(source).withPathSensitivity(PathSensitivity.NONE)
    outputs.file(target)
    doLast {
        fun isNull(x: Any?) = x is Map<*, *> && x.size == 1 && x["type"] == "null"
        fun norm(x: Any?): Any? = when (x) {
            is Map<*, *> -> {
                val m = LinkedHashMap<String, Any?>()
                x.forEach { (k, v) -> m[k.toString()] = norm(v) }
                listOf("anyOf", "oneOf").forEach { key ->
                    val options = m[key] as? List<*>
                    val other = options?.singleOrNull { !isNull(it) } as? Map<*, *>
                    if (options?.size == 2 && options.any(::isNull) && other != null &&
                        other["type"] in setOf("string", "integer", "number", "boolean")
                    ) {
                        m.remove(key)
                        other.forEach { (k, v) -> m[k.toString()] = v }
                        m["type"] = listOf(other["type"], "null")
                    }
                }
                m
            }
            is List<*> -> x.map(::norm)
            else -> x
        }
        val out = target.get().asFile
        out.parentFile.mkdirs()
        out.writeText(groovy.json.JsonOutput.toJson(norm(groovy.json.JsonSlurper().parse(source))))
    }
}

openApiGenerate {
    generatorName.set("kotlin")
    // A fresh output each time: no stale classes from an older spec.
    cleanupOutput.set(true)
    library.set("jvm-retrofit2")
    // A file: URI, so paths with spaces resolve (the generator parses the spec location as a URI).
    inputSpec.set(normalizedSpec.map { it.asFile.toURI().toString() })
    outputDir.set(generatedDir.map { it.asFile.absolutePath })
    packageName.set("ke.kejasha.api")
    apiPackage.set("ke.kejasha.api.endpoints")
    modelPackage.set("ke.kejasha.api.models")
    generateApiTests.set(false)
    generateModelTests.set(false)
    generateApiDocumentation.set(false)
    generateModelDocumentation.set(false)
    // Free-form JSON values (e.g. the values inside AuditEntry.diff) are JsonElement.
    // `number` is only used for coordinates (money is integer cents): a plain Double decodes the
    // API's JSON number, where the generated BigDecimal adapter expects a string.
    typeMappings.putAll(mapOf("AnyType" to "kotlinx.serialization.json.JsonElement", "number" to "kotlin.Double"))
    importMappings.putAll(mapOf("kotlinx.serialization.json.JsonElement" to "kotlinx.serialization.json.JsonElement"))
    // `{ ok: const true }` cannot be generated as Kotlin; use the hand-checked support type.
    schemaMappings.putAll(mapOf("Accepted" to "ke.kejasha.api.support.Accepted"))
    ignoreFileOverride.set(layout.projectDirectory.file("openapi-generator-ignore").asFile.absolutePath)
    configOptions.putAll(
        mapOf(
            "serializationLibrary" to "kotlinx_serialization",
            "useCoroutines" to "true",
            "enumPropertyNaming" to "UPPERCASE",
            "dateLibrary" to "string",
            "omitGradleWrapper" to "true",
            "omitGradlePluginVersions" to "true",
        ),
    )
}

kotlin {
    jvmToolchain(17)
    sourceSets.main {
        kotlin.srcDir(generatedDir.map { it.dir("src/main/kotlin") })
    }
}

// The spec's content is the input (inputSpec is a URI string Gradle cannot track).
tasks.named("openApiGenerate") {
    dependsOn(normalizeSpec)
    inputs.file(normalizedSpec).withPathSensitivity(PathSensitivity.NONE)
}

/**
 * openapi-generator 7.14 drops `null` from some OpenAPI 3.1 nullable properties (`type: [T, "null"]`
 * or `anyOf: [T, {type: null}]`), so the API's null would fail to decode. The spec is the truth:
 * every property it marks nullable becomes nullable in the generated model.
 */
val markNullable by tasks.registering {
    dependsOn("openApiGenerate")
    val specFile = normalizedSpec
    val models = generatedDir.map { it.dir("src/main/kotlin/ke/kejasha/api/models").asFile }
    inputs.file(specFile).withPathSensitivity(PathSensitivity.NONE)
    outputs.dir(models)
    dependsOn(normalizeSpec)
    doLast {
        @Suppress("UNCHECKED_CAST")
        val schemas = ((groovy.json.JsonSlurper().parse(specFile.get().asFile) as Map<String, Any?>)["components"] as Map<String, Any?>)["schemas"] as Map<String, Map<String, Any?>>
        fun nullable(p: Map<*, *>): Boolean =
            (p["type"] as? List<*>)?.contains("null") == true ||
                listOf("anyOf", "oneOf").any { k -> (p[k] as? List<*>)?.any { (it as? Map<*, *>)?.get("type") == "null" } == true }
        val modelDir = models.get()
        // Inline objects are generated as <Schema><Prop> (objects) and <Schema><Prop>Inner (array items).
        fun fix(className: String, schema: Map<*, *>) {
            val props = schema["properties"] as? Map<*, *> ?: return
            props.forEach { (k, v) ->
                val child = v as? Map<*, *> ?: return@forEach
                val cap = k.toString().replaceFirstChar { it.uppercase() }
                when {
                    child["type"] == "object" -> fix(className + cap, child)
                    (child["items"] as? Map<*, *>)?.get("type") == "object" -> fix(className + cap + "Inner", child["items"] as Map<*, *>)
                }
            }
            val file = modelDir.resolve("$className.kt")
            if (!file.exists()) return
            var text = file.readText()
            props.filter { (_, v) -> v is Map<*, *> && nullable(v) }.keys.forEach { prop ->
                text = Regex("""(@SerialName\(value = "$prop"\)\s+val $prop: )([^,\n?=]+?)(\s*[,\n])""").replace(text) { m ->
                    "${m.groupValues[1]}${m.groupValues[2]}?${m.groupValues[3]}"
                }
            }
            file.writeText(text)
        }
        schemas.forEach { (name, schema) -> fix(name, schema) }
    }
}

tasks.named("compileKotlin") { dependsOn(markNullable) }

dependencies {
    api(libs.retrofit)
    api(libs.retrofit.kotlinx.serialization)
    api(libs.retrofit.scalars)
    api(libs.okhttp)
    implementation(libs.okhttp.logging) // used by the generated ApiClient
    api(libs.serialization.json)
}
