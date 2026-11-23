plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

/** Production API URL from configuration (ADR-016): -PkejashaApiUrl=https://api.<APP_DOMAIN>. */
val prodApiUrl: String = (findProperty("kejashaApiUrl") as String?).orEmpty()

android {
    namespace = "ke.kejasha.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "ke.kejasha.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    flavorDimensions += "env"
    productFlavors {
        create("dev") {
            dimension = "env"
            applicationIdSuffix = ".dev"
            // The emulator reaches the host's localhost at 10.0.2.2.
            buildConfigField("String", "API_URL", "\"http://10.0.2.2:4000\"")
        }
        create("prod") {
            dimension = "env"
            buildConfigField("String", "API_URL", "\"$prodApiUrl\"")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
        // Robolectric: Room and the sync engine run against a real (in-memory) SQLite.
        unitTests.isIncludeAndroidResources = true
    }

    lint {
        warningsAsErrors = true
        abortOnError = true
        // Versions are pinned in the version catalog on purpose (docs/plans/phase-a.md).
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion", "OldTargetApi")
    }
}

kotlin { jvmToolchain(17) }

// Room schemas are committed so later versions can be migrated and tested.
ksp { arg("room.schemaLocation", "$projectDir/schemas") }

// A prod build without an API URL would ship broken: fail early instead.
tasks.matching { it.name.startsWith("assembleProd") || it.name.startsWith("bundleProd") }.configureEach {
    val url = prodApiUrl // captured as a value, so the configuration cache can store the task
    doFirst {
        check(url.startsWith("https://")) { "Set -PkejashaApiUrl=https://api.<APP_DOMAIN> for prod builds" }
    }
}

dependencies {
    implementation(project(":api-client"))

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.runtime)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.navigation.compose)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)

    implementation(libs.datastore.preferences)
    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    implementation(libs.work.runtime)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.serialization.json)
    implementation(libs.coil.compose)
    implementation(libs.coil.network)

    debugImplementation(libs.compose.ui.tooling)
    debugImplementation(libs.compose.ui.test.manifest)

    testImplementation(libs.junit)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.work.testing)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test.junit4)
}
