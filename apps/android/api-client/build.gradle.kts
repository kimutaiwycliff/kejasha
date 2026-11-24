// Generated from apps/api/openapi.json at build time (ADR-017). Never edit the output by hand.
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.openapi.generator)
}

val spec = rootProject.layout.projectDirectory.file("../api/openapi.json")
val generatedDir = layout.buildDirectory.dir("generated/openapi")

openApiGenerate {
    generatorName.set("kotlin")
    library.set("jvm-retrofit2")
    // A file: URI, so paths with spaces resolve (the generator parses the spec location as a URI).
    inputSpec.set(spec.asFile.toURI().toString())
    outputDir.set(generatedDir.map { it.asFile.absolutePath })
    packageName.set("ke.kejasha.api")
    apiPackage.set("ke.kejasha.api.endpoints")
    modelPackage.set("ke.kejasha.api.models")
    generateApiTests.set(false)
    generateModelTests.set(false)
    generateApiDocumentation.set(false)
    generateModelDocumentation.set(false)
    // Free-form JSON values (e.g. the values inside AuditEntry.diff) are JsonElement.
    typeMappings.putAll(mapOf("AnyType" to "kotlinx.serialization.json.JsonElement"))
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
tasks.named("openApiGenerate") { inputs.file(spec).withPathSensitivity(PathSensitivity.NONE) }

/**
 * openapi-generator 7.14 drops `null` from some OpenAPI 3.1 nullable properties (`type: [T, "null"]`
 * or `anyOf: [T, {type: null}]`), so the API's null would fail to decode. The spec is the truth:
 * every property it marks nullable becomes nullable in the generated model.
 */
val markNullable by tasks.registering {
    dependsOn("openApiGenerate")
    val specFile = spec.asFile
    val models = generatedDir.map { it.dir("src/main/kotlin/ke/kejasha/api/models").asFile }
    inputs.file(specFile).withPathSensitivity(PathSensitivity.NONE)
    outputs.dir(models)
    doLast {
        @Suppress("UNCHECKED_CAST")
        val schemas = ((groovy.json.JsonSlurper().parse(specFile) as Map<String, Any?>)["components"] as Map<String, Any?>)["schemas"] as Map<String, Map<String, Any?>>
        fun nullable(p: Map<*, *>): Boolean =
            (p["type"] as? List<*>)?.contains("null") == true ||
                listOf("anyOf", "oneOf").any { k -> (p[k] as? List<*>)?.any { (it as? Map<*, *>)?.get("type") == "null" } == true }
        schemas.forEach { (name, schema) ->
            val file = models.get().resolve("$name.kt")
            val props = schema["properties"] as? Map<*, *> ?: return@forEach
            if (!file.exists()) return@forEach
            var text = file.readText()
            props.filter { (_, v) -> v is Map<*, *> && nullable(v) }.keys.forEach { prop ->
                text = Regex("""(@SerialName\(value = "$prop"\)\s+val $prop: )([^,\n?=]+?)(\s*[,\n])""").replace(text) { m ->
                    "${m.groupValues[1]}${m.groupValues[2]}?${m.groupValues[3]}"
                }
            }
            file.writeText(text)
        }
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
