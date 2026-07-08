import groovy.json.JsonSlurper

pluginManagement {
    repositories {
        gradlePluginPortal()
        maven("https://maven.fabricmc.net/")
        maven("https://maven.neoforged.net/releases/")
        maven("https://maven.minecraftforge.net/")
        maven("https://maven.architectury.dev/")
    }
}

rootProject.name = "client-mod-mc26"

val javaVersionMajor = JavaVersion.current().majorVersion.toInt()
val variantCatalog = JsonSlurper().parse(file("../variants.json")) as Map<*, *>
val buildableVariants = (variantCatalog["variants"] as List<*>)
    .filterIsInstance<Map<*, *>>()
    .filter { it["gradleBuild"] == "mc26" }
    .filter { it["gradleModule"] != null }
val includedVariants = buildableVariants
    .filter { (it["javaVersion"] as Number).toInt() <= javaVersionMajor }
    .filter { file("${it["gradleModule"]}/build.gradle.kts").exists() }
val variantsByModule = includedVariants.associateBy { it["gradleModule"].toString() }

include(*includedVariants.map { it["gradleModule"].toString() }.toTypedArray())

gradle.beforeProject {
    val variant = variantsByModule[name] ?: return@beforeProject
    extensions.extraProperties["mcVersion"] = variant["minecraftVersion"].toString()
    extensions.extraProperties["javaVersion"] = variant["javaVersion"].toString()

    variant["fabricLoaderVersion"]?.let {
        extensions.extraProperties["fabricLoader"] = it.toString()
    }
    variant["forgeVersion"]?.let {
        extensions.extraProperties["forgeVersion"] = it.toString()
        extensions.extraProperties["loom.platform"] = "forge"
    }
    variant["neoforgeVersion"]?.let {
        extensions.extraProperties["neoforgeVersion"] = it.toString()
        extensions.extraProperties["loom.platform"] = "neoforge"
    }
}
