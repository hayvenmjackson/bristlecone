plugins {
    id("com.android.application")
}

android {
    namespace = "app.bristlecone"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.bristlecone"
        minSdk = 26
        targetSdk = 35
        versionCode = 3
        versionName = "1.1.0"
    }

    sourceSets {
        getByName("main") {
            // Theme overrides that need API 35 resources live here so the Gradle-free build still works.
            res.srcDirs("src/main/res", "src/gradle/res")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    androidResources {
        noCompress += listOf("woff2", "pbf")
    }

    lint {
        abortOnError = false
    }
}

// No third-party Android dependencies: the map engine (MapLibre GL JS) ships inside assets/web.
