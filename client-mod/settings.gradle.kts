import groovy.json.JsonSlurper

pluginManagement {
    repositories {
        gradlePluginPortal()
        maven("https://maven.architectury.dev/")
        maven("https://maven.fabricmc.net/")
        maven("https://maven.minecraftforge.net/")
    }
}

rootProject.name = "client-mod"

val javaVersionMajor = JavaVersion.current().majorVersion.toInt()
val variantCatalog = JsonSlurper().parse(file("variants.json")) as Map<*, *>
val buildableVariants = (variantCatalog["variants"] as List<*>)
    .filterIsInstance<Map<*, *>>()
    .filter { it["gradleModule"] != null }
val includedVariants = buildableVariants
    .filter { (it["javaVersion"] as Number).toInt() <= javaVersionMajor }
val variantsByModule = includedVariants.associateBy { it["gradleModule"].toString() }
val mappingsByMinecraftVersion = buildableVariants
    .filter { it["yarnMappings"] != null }
    .associate { it["minecraftVersion"].toString() to it["yarnMappings"].toString() }

include(*includedVariants.map { it["gradleModule"].toString() }.toTypedArray())

gradle.beforeProject {
    val variant = variantsByModule[name] ?: return@beforeProject
    extensions.extraProperties["mcVersion"] = variant["minecraftVersion"].toString()
    extensions.extraProperties["javaVersion"] = variant["javaVersion"].toString()

    extensions.extraProperties["yarnMappings"] =
        variant["yarnMappings"]?.toString()
            ?: mappingsByMinecraftVersion.getValue(variant["minecraftVersion"].toString())
    variant["fabricLoaderVersion"]?.let {
        extensions.extraProperties["fabricLoader"] = it.toString()
    }
    variant["forgeVersion"]?.let {
        extensions.extraProperties["forgeVersion"] = it.toString()
        extensions.extraProperties["loom.platform"] = "forge"
    }
    variant["yarnForgePatch"]?.let {
        extensions.extraProperties["yarnForgePatch"] = it.toString()
    }
    variant["neoforgeVersion"]?.let {
        extensions.extraProperties["neoforgeVersion"] = it.toString()
        extensions.extraProperties["loom.platform"] =
            variant["loomPlatform"]?.toString() ?: "neoforge"
    }
    variant["yarnNeoforgePatch"]?.let {
        extensions.extraProperties["yarnNeoforgePatch"] = it.toString()
    }
}
