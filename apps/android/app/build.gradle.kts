import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

// Release signing: env vars first, then infrastructure/secrets/android-signing.local.env
// (git-ignored, outside the app). Missing -> release falls back to the debug key.
val signingEnv: Map<String, String> = run {
    val file = rootProject.file("../../infrastructure/secrets/android-signing.local.env")
    val fromFile = mutableMapOf<String, String>()
    if (file.exists()) {
        file.readLines().map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("#") && "=" in it }
            .forEach { fromFile[it.substringBefore("=")] = it.substringAfter("=") }
    }
    fun v(k: String) = System.getenv(k) ?: fromFile[k]
    listOf("KEYSTORE_PASSWORD", "KEY_ALIAS", "KEY_PASSWORD").mapNotNull { k -> v(k)?.let { k to it } }.toMap()
}
val releaseKeystore = rootProject.file("../../infrastructure/secrets/android-release.jks")
val haveReleaseSigning = releaseKeystore.exists() && signingEnv.size == 3

val appVersionName = "4.2.0"
val appVersionCode = 42000

android {
    namespace = "com.mizibu.retfast"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.mizibu.retfast"
        minSdk = 26
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersionName
        buildConfigField("String", "API_BASE_URL", "\"https://api.retfast.com\"")
        buildConfigField("String", "WS_BASE_URL", "\"wss://api.retfast.com\"")
        resourceConfigurations += listOf("tr", "en")
        // MapLibre ships native libs per ABI; x86 (32-bit) emulators are not a target, which keeps the APK smaller.
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64") }
    }

    signingConfigs {
        if (haveReleaseSigning) {
            create("release") {
                storeFile = releaseKeystore
                storePassword = signingEnv["KEYSTORE_PASSWORD"]
                keyAlias = signingEnv["KEY_ALIAS"]
                keyPassword = signingEnv["KEY_PASSWORD"]
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            // ./gradlew assembleDebug -PlocalBackend=true  -> emulator talks to the host's :8080
            if (project.hasProperty("localBackend")) {
                buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:8080\"")
                buildConfigField("String", "WS_BASE_URL", "\"ws://10.0.2.2:8080\"")
            }
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (haveReleaseSigning) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            isReturnDefaultValues = true
        }
    }
    lint {
        abortOnError = true
        checkReleaseBuilds = true
        warningsAsErrors = false
    }
    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "META-INF/LICENSE*")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    val bom = platform(libs.compose.bom)
    implementation(bom)
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.activity.compose)
    implementation(libs.nav.compose)
    implementation(libs.lifecycle.vm.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.core.ktx)
    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    implementation(libs.work.runtime)
    implementation(libs.okhttp)
    implementation(libs.serialization.json)
    implementation(libs.coroutines.android)
    implementation(libs.play.location)
    implementation(libs.maplibre)

    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.room.testing)
    testImplementation(libs.serialization.json)
}
