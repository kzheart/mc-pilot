plugins {
    id("mct-version-base")
}

val mcVersion: String by project
val forgeVersion: String by project
val javaVersion: String by project
val forgeMajor = forgeVersion.substringBefore(".")

base {
    archivesName.set("mct-client-mod-forge-$mcVersion")
}

extensions.configure<net.fabricmc.loom.api.LoomGradleExtensionAPI>("loom") {
    forge {}
}

dependencies {
    add("forge", "net.minecraftforge:forge:$mcVersion-$forgeVersion")
}

tasks.processResources {
    val expandedProperties = mapOf(
        "version" to project.version.toString(),
        "mc_version" to mcVersion,
        "forge_version" to forgeVersion,
        "forge_major" to forgeMajor,
        "java_version" to javaVersion
    )

    inputs.properties(expandedProperties)

    filesMatching("META-INF/mods.toml") {
        expand(expandedProperties)
    }
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(javaVersion.toInt()))
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(javaVersion.toInt())
    options.encoding = "UTF-8"
}

tasks.withType<Jar>().configureEach {
    manifest {
        attributes("MixinConfigs" to "mct.mixins.json")
    }
}
