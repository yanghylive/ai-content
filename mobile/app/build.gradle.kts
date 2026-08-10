plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.aicontent.mobile"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.aicontent.desktop.mobile" // 与桌面端同产品线（appId 标识）
        minSdk = 26 // Android 8.0+（前台服务/无障碍）
        targetSdk = 35
        versionCode = 4
        versionName = "0.1.3"
    }

    buildFeatures {
        // MainActivity 按 BuildConfig 区分联调地址（10.0.2.2 本机）与线上地址
        buildConfig = true
    }

    buildTypes {
        debug {
            // -PhomeBase=https://aicontent.vip.kaypal.cn 出线上真机包；默认本机联调
            buildConfigField(
                "String",
                "HOME_BASE",
                "\"${project.findProperty("homeBase") ?: "http://10.0.2.2:3421"}\"",
            )
        }
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    // 下拉刷新（批次 C #11：WebView 顶部下拉整页刷新）
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    // 网络（C3 API 对接）
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // JSON（payload 解析）
    implementation("org.json:json:20240303")
}
