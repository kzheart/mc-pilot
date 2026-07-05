plugins {
    id("mct-version-base")
}

val mcVersion: String by project
val neoforgeVersion: String by project
val javaVersion: String by project
val neoforgeMajor = neoforgeVersion.substringBefore(".")
// 1.20.1 时代 NeoForge 以 net.neoforged:forge 坐标发布,userdev 与 MinecraftForge 同构,走 forge 平台
val forgeCompatPlatform = (project.findProperty("loom.platform") as? String) == "forge"

base {
    archivesName.set("mct-client-mod-neoforge-$mcVersion")
}

if (forgeCompatPlatform) {
    extensions.configure<net.fabricmc.loom.api.LoomGradleExtensionAPI>("loom") {
        forge {}
    }
    dependencies {
        add("forge", "net.neoforged:forge:$mcVersion-$neoforgeVersion")
    }
} else {
    dependencies {
        add("neoForge", "net.neoforged:neoforge:$neoforgeVersion")
    }
}

tasks.processResources {
    val expandedProperties = mapOf(
        "version" to project.version.toString(),
        "mc_version" to mcVersion,
        "neoforge_version" to neoforgeVersion,
        "neoforge_major" to neoforgeMajor,
        // forge-compat 模块(1.20.1)复用 shared/forge/resources 的 mods.toml 模板
        "forge_version" to neoforgeVersion,
        "forge_major" to neoforgeMajor,
        "java_version" to javaVersion
    )

    inputs.properties(expandedProperties)

    filesMatching(listOf("META-INF/mods.toml", "META-INF/neoforge.mods.toml")) {
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
