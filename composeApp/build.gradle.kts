import org.jetbrains.compose.desktop.application.dsl.TargetFormat

val appVersion = "1.0.0"
val appName = "Adbmime"

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.jetbrainsCompose)
    id("org.openjfx.javafxplugin")
}

javafx {
    version = "17.0.10"
    modules("javafx.controls", "javafx.fxml")
}

kotlin {
    jvm("desktop")
    
    sourceSets {
        val desktopMain by getting {
            dependencies {
                implementation(compose.desktop.currentOs)
                implementation(compose.runtime)
                implementation(compose.foundation)
                implementation(compose.material)
                implementation(compose.ui)
                implementation(compose.components.resources)
                implementation(compose.components.uiToolingPreview)

                val javafxVersion = "17.0.10"
                val osName = System.getProperty("os.name").lowercase()
                val target = when {
                    osName.contains("win") -> "win"
                    osName.contains("mac") -> "mac"
                    else -> "linux"
                }
                val arch = System.getProperty("os.arch")
                val classifier = if (osName.contains("mac") && arch == "aarch64") "mac-aarch64" else target

                implementation("org.openjfx:javafx-controls:$javafxVersion:$classifier")
                implementation("org.openjfx:javafx-fxml:$javafxVersion:$classifier")
                implementation("org.openjfx:javafx-graphics:$javafxVersion:$classifier")
                implementation("org.openjfx:javafx-base:$javafxVersion:$classifier")
            }
        }
        val desktopTest by getting {
            dependencies {
                implementation(kotlin("test"))
            }
        }
    }
}

compose.desktop {
    application {
        mainClass = "it.adbmime.demo.Launcher"

        nativeDistributions {
            targetFormats(TargetFormat.Dmg, TargetFormat.Msi, TargetFormat.Deb)
            packageName = appName
            packageVersion = appVersion
            
            linux {
                iconFile.set(project.file("src/desktopMain/resources/application/linux/adbmime.png"))
            }
            macOS {
                iconFile.set(project.file("src/desktopMain/resources/application/mac/adbmime.icns"))
            }
            windows {
                iconFile.set(project.file("src/desktopMain/resources/application/windows/adbmime.ico"))
            }
        }
    }
}
