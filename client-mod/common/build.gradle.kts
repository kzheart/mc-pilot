plugins {
    id("fabric-loom")
}

val mcVersion: String by rootProject.extra
val yarnMappings: String by rootProject.extra
val fabricLoader: String by rootProject.extra
val javaVersion: Int by rootProject.extra

dependencies {
    minecraft("com.mojang:minecraft:$mcVersion")
    mappings("net.fabricmc:yarn:$yarnMappings:v2")
    modImplementation("net.fabricmc:fabric-loader:$fabricLoader")
    implementation("org.java-websocket:Java-WebSocket:${rootProject.property("java_websocket_version")}")
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
    val versionedMixins = mutableListOf<String>()
    if (stonecutter.compare(mcVersion, "1.20.3") >= 0) {
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
}

java {
    sourceCompatibility = JavaVersion.toVersion(javaVersion)
    targetCompatibility = JavaVersion.toVersion(javaVersion)
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(javaVersion)
    options.encoding = "UTF-8"
}
