pluginManagement {
    repositories {
        gradlePluginPortal()
        maven("https://maven.fabricmc.net/")
    }
}

rootProject.name = "client-mod"

val javaVersionMajor = JavaVersion.current().majorVersion.toInt()

include("version-1.18.2", "version-1.20.1", "version-1.20.2", "version-1.20.4")

if (javaVersionMajor >= 21) {
    include("version-1.21.1", "version-1.21.4")
}
