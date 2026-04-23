plugins {
    id("dev.architectury.loom")
}

val mcVersion: String by project
val yarnMappings: String by project
val forgeVersion: String by project
val javaVersion: String by project
val forgeMajor = forgeVersion.substringBefore(".")

version = rootProject.property("mod_version") as String
group = rootProject.property("maven_group") as String

base {
    archivesName.set("mct-client-mod-forge-$mcVersion")
}

repositories {
    mavenCentral()
    maven("https://maven.architectury.dev/")
    maven("https://maven.fabricmc.net/")
    maven("https://maven.minecraftforge.net/")
}

extensions.configure<net.fabricmc.loom.api.LoomGradleExtensionAPI>("loom") {
    forge {}
    mixin {
        defaultRefmapName.set("mct.refmap.json")
    }
}

dependencies {
    minecraft("com.mojang:minecraft:$mcVersion")
    mappings("net.fabricmc:yarn:$yarnMappings:v2")
    add("forge", "net.minecraftforge:forge:$mcVersion-$forgeVersion")
    implementation("org.java-websocket:Java-WebSocket:${rootProject.property("java_websocket_version")}")
    include("org.java-websocket:Java-WebSocket:${rootProject.property("java_websocket_version")}")
}

val genDir = layout.buildDirectory.dir("generated/src/main/java")

tasks.register("generateVersionInfo") {
    val outputFile = genDir.map { it.file("com/mct/version/generated/TargetVariant.java") }
    outputs.file(outputFile)
    doLast {
        outputFile.get().asFile.parentFile.mkdirs()
        outputFile.get().asFile.writeText(
            """
            package com.mct.version.generated;

            public final class TargetVariant {
                public static final String MC_VERSION = "$mcVersion";
                private TargetVariant() {}
            }
            """.trimIndent()
        )
    }
}

sourceSets.main {
    java.srcDir(genDir)
}

tasks.named("compileJava") { dependsOn("generateVersionInfo") }

tasks.processResources {
    inputs.property("version", project.version)
    inputs.property("mcVersion", mcVersion)
    inputs.property("forgeVersion", forgeVersion)
    inputs.property("forgeMajor", forgeMajor)
    inputs.property("javaVersion", javaVersion)

    filesMatching("META-INF/mods.toml") {
        expand(
            "version" to project.version,
            "mc_version" to mcVersion,
            "forge_version" to forgeVersion,
            "forge_major" to forgeMajor,
            "java_version" to javaVersion
        )
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

tasks.withType<org.gradle.api.tasks.bundling.AbstractArchiveTask>().configureEach {
    archiveVersion.set("")
}
