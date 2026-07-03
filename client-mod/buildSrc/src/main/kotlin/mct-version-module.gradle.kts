plugins {
    id("mct-version-base")
}

val mcVersion: String by project
val fabricLoader: String by project
val javaVersion: String by project

base {
    archivesName.set("mct-client-mod-fabric-$mcVersion")
}

dependencies {
    modImplementation("net.fabricmc:fabric-loader:$fabricLoader")
}

tasks.processResources {
    val expandedProperties = mapOf(
        "version" to project.version.toString(),
        "mc_version" to mcVersion,
        "fabric_loader" to fabricLoader,
        "java_version" to javaVersion
    )

    inputs.properties(expandedProperties)

    filesMatching("fabric.mod.json") {
        expand(expandedProperties)
    }
}
