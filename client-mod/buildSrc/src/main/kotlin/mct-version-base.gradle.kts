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
}

dependencies {
    minecraft("com.mojang:minecraft:$targetMcVersion")
    mappings("net.fabricmc:yarn:$yarnMappings:v2")
    implementation("org.java-websocket:Java-WebSocket:${rootProject.property("java_websocket_version")}")
    include("org.java-websocket:Java-WebSocket:${rootProject.property("java_websocket_version")}")
}

loom {
    mixin {
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
