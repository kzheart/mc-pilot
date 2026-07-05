plugins {
    id("dev.architectury.loom")
}

val targetMcVersion = project.property("mcVersion") as String
val yarnMappings: String by project
val javaVersion: String by project

version = rootProject.property("mod_version") as String
group = rootProject.property("maven_group") as String

repositories {
    mavenCentral()
    maven("https://maven.architectury.dev/")
    maven("https://maven.fabricmc.net/")
    maven("https://maven.minecraftforge.net/")
    maven("https://maven.neoforged.net/releases/")
}

dependencies {
    minecraft("com.mojang:minecraft:$targetMcVersion")
    if (project.hasProperty("yarnForgePatch")) {
        mappings(loom.layered {
            mappings("net.fabricmc:yarn:$yarnMappings:v2")
            mappings("dev.architectury:yarn-mappings-patch-forge:${project.property("yarnForgePatch")}")
        })
    } else if (project.hasProperty("yarnNeoforgePatch")) {
        mappings(loom.layered {
            mappings("net.fabricmc:yarn:$yarnMappings:v2")
            mappings("dev.architectury:yarn-mappings-patch-neoforge:${project.property("yarnNeoforgePatch")}")
        })
    } else {
        mappings("net.fabricmc:yarn:$yarnMappings:v2")
    }
    implementation("org.java-websocket:Java-WebSocket:${rootProject.property("java_websocket_version")}")
    include("org.java-websocket:Java-WebSocket:${rootProject.property("java_websocket_version")}")
}

loom {
    mixin {
        // neoforge 平台上 Loom 默认关闭 legacy Mixin AP,需显式开启才能配置 refmap
        if ((project.findProperty("loom.platform") as? String) == "neoforge") {
            useLegacyMixinAp.set(true)
        }
        defaultRefmapName.set("mct.refmap.json")
    }
}

val genDir = layout.buildDirectory.dir("generated/src/main/java")

tasks.register<GenerateVersionInfoTask>("generateVersionInfo") {
    mcVersion.set(targetMcVersion)
    outputFile.set(genDir.map { it.file("com/mct/version/generated/TargetVariant.java") })
}

sourceSets.main {
    java.srcDir(genDir)
}

tasks.named("compileJava") { dependsOn("generateVersionInfo") }

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(javaVersion.toInt()))
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(javaVersion.toInt())
    options.encoding = "UTF-8"
}

tasks.withType<org.gradle.api.tasks.bundling.AbstractArchiveTask>().configureEach {
    archiveVersion.set("")
}
