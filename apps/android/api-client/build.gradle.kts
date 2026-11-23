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

tasks.named("compileKotlin") { dependsOn("openApiGenerate") }

dependencies {
    api(libs.retrofit)
    api(libs.retrofit.kotlinx.serialization)
    api(libs.retrofit.scalars)
    api(libs.okhttp)
    implementation(libs.okhttp.logging) // used by the generated ApiClient
    api(libs.serialization.json)
}
