pluginManagement {
    repositories {
        gradlePluginPortal()
        maven("https://maven.fabricmc.net/")
    }
}

rootProject.name = "client-mod"

include(
    "version-1.18.2",
    "version-1.20.1",
    "version-1.20.2",
    "version-1.20.4",
    "version-1.21.1",
    "version-1.21.4"
)
