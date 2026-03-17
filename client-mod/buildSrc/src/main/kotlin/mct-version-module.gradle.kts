plugins {
    id("fabric-loom")
}

val mcVersion: String by project
val yarnMappings: String by project
val fabricLoader: String by project
val javaVersion: String by project

version = rootProject.property("mod_version") as String
group = rootProject.property("maven_group") as String

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
    implementation("org.java-websocket:Java-WebSocket:${rootProject.property("java_websocket_version")}")
    include("org.java-websocket:Java-WebSocket:${rootProject.property("java_websocket_version")}")
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

tasks.processResources {
    inputs.property("version", project.version)
    inputs.property("mcVersion", mcVersion)
    inputs.property("fabricLoader", fabricLoader)
    inputs.property("javaVersion", javaVersion)

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
    sourceCompatibility = JavaVersion.toVersion(javaVersion.toInt())
    targetCompatibility = JavaVersion.toVersion(javaVersion.toInt())
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(javaVersion.toInt())
    options.encoding = "UTF-8"
}

tasks.withType<org.gradle.api.tasks.bundling.AbstractArchiveTask>().configureEach {
    archiveVersion.set("")
}
