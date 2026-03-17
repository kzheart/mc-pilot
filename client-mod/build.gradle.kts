plugins {
    id("dev.kikugie.stonecutter")
    id("fabric-loom") version "1.9-SNAPSHOT" apply false
    id("dev.architectury.loom") version "1.7-SNAPSHOT" apply false
}

val mcVersion = stonecutter.current.version

val versionConfig = mapOf(
    "1.20.1" to mapOf(
        "yarn_mappings" to "1.20.1+build.10",
        "fabric_loader" to "0.16.10",
        "forge_version" to "47.3.0",
        "java_version" to 17,
        "loaders" to listOf("fabric", "forge")
    ),
    "1.20.2" to mapOf(
        "yarn_mappings" to "1.20.2+build.4",
        "fabric_loader" to "0.16.10",
        "forge_version" to "48.1.0",
        "java_version" to 17,
        "loaders" to listOf("fabric", "forge")
    ),
    "1.20.4" to mapOf(
        "yarn_mappings" to "1.20.4+build.3",
        "fabric_loader" to "0.16.10",
        "forge_version" to "49.0.49",
        "neoforge_version" to "20.4.237",
        "java_version" to 17,
        "loaders" to listOf("fabric", "forge", "neoforge")
    ),
    "1.21.1" to mapOf(
        "yarn_mappings" to "1.21.1+build.3",
        "fabric_loader" to "0.16.10",
        "neoforge_version" to "21.1.77",
        "java_version" to 21,
        "loaders" to listOf("fabric", "neoforge")
    ),
    "1.21.4" to mapOf(
        "yarn_mappings" to "1.21.4+build.1",
        "fabric_loader" to "0.16.10",
        "neoforge_version" to "21.4.75",
        "java_version" to 21,
        "loaders" to listOf("fabric", "neoforge")
    )
)

val config = versionConfig[mcVersion] ?: error("Unknown version: $mcVersion")
val enabledLoaders = config["loaders"] as List<*>

extra["mcVersion"] = mcVersion
extra["yarnMappings"] = config["yarn_mappings"]
extra["fabricLoader"] = config["fabric_loader"]
extra["javaVersion"] = config["java_version"]
extra["enabledLoaders"] = enabledLoaders
if (config.containsKey("forge_version")) extra["forgeVersion"] = config["forge_version"]
if (config.containsKey("neoforge_version")) extra["neoforgeVersion"] = config["neoforge_version"]

subprojects {
    group = rootProject.property("maven_group") as String
    version = rootProject.property("mod_version") as String
}
