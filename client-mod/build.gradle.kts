plugins {
    id("dev.kikugie.stonecutter")
    id("fabric-loom") version "1.6.12"
}

val mcVersion = stonecutter.current.version  // semantic version, e.g. "1.20.4"

val versionConfig = mapOf(
    "1.20.1" to mapOf(
        "yarn_mappings" to "1.20.1+build.10",
        "fabric_loader" to "0.16.10",
        "java_version" to 17
    ),
    "1.20.2" to mapOf(
        "yarn_mappings" to "1.20.2+build.4",
        "fabric_loader" to "0.16.10",
        "java_version" to 17
    ),
    "1.20.4" to mapOf(
        "yarn_mappings" to "1.20.4+build.3",
        "fabric_loader" to "0.16.10",
        "java_version" to 17
    ),
    "1.21.1" to mapOf(
        "yarn_mappings" to "1.21.1+build.3",
        "fabric_loader" to "0.16.10",
        "java_version" to 21
    ),
    "1.21.4" to mapOf(
        "yarn_mappings" to "1.21.4+build.1",
        "fabric_loader" to "0.16.10",
        "java_version" to 21
    )
)

val config = versionConfig[mcVersion] ?: error("Unknown version: $mcVersion")
val yarnMappings = config["yarn_mappings"] as String
val fabricLoader = config["fabric_loader"] as String
val javaVersion = config["java_version"] as Int

version = property("mod_version") as String
group = property("maven_group") as String

base {
    archivesName.set("mct-client-mod-fabric-$mcVersion")
}

repositories {
    mavenCentral()
}

dependencies {
    minecraft("com.mojang:minecraft:$mcVersion")
    mappings("net.fabricmc:yarn:$yarnMappings:v2")
    modImplementation("net.fabricmc:fabric-loader:$fabricLoader")
    implementation("org.java-websocket:Java-WebSocket:${property("java_websocket_version")}")
    include("org.java-websocket:Java-WebSocket:${property("java_websocket_version")}")
}

loom {
    mixin {
        defaultRefmapName.set("mct.refmap.json")
    }
}

// Code generation: TargetVariant.java
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

// Dynamic Mixin JSON generation
tasks.processResources {
    inputs.property("version", project.version)
    inputs.property("mcVersion", mcVersion)
    inputs.property("fabricLoader", fabricLoader)
    inputs.property("javaVersion", javaVersion)

    val versionedMixins = mutableListOf<String>()
    if (stonecutter.eval(mcVersion, ">=1.20.3")) {
        versionedMixins.add("ServerResourcePackManagerMixin")
    }
    inputs.property("extra_client_mixins", versionedMixins.joinToString(","))

    filesMatching("mct.mixins.json") {
        expand(
            "extra_client_mixins" to
                if (versionedMixins.isEmpty()) ""
                else ",\n    " + versionedMixins.joinToString(",\n    ") { "\"$it\"" }
        )
    }

    filesMatching("fabric.mod.json") {
        expand(
            "version" to project.version,
            "mc_version" to mcVersion,
            "fabric_loader" to fabricLoader,
            "java_version" to javaVersion
        )
    }
}

java {
    sourceCompatibility = JavaVersion.toVersion(javaVersion)
    targetCompatibility = JavaVersion.toVersion(javaVersion)
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(javaVersion)
    options.encoding = "UTF-8"
}

tasks.withType<org.gradle.api.tasks.bundling.AbstractArchiveTask>().configureEach {
    archiveVersion.set("")
}
