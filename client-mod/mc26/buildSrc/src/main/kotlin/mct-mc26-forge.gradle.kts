plugins {
    id("dev.architectury.loom")
}

val targetMcVersion = project.property("mcVersion") as String
val forgeVersion: String by project
val javaVersion: String by project
val forgeMajor = forgeVersion.substringBefore(".")

version = rootProject.property("mod_version") as String
group = rootProject.property("maven_group") as String

repositories {
    mavenCentral()
    maven("https://maven.fabricmc.net/")
    maven("https://maven.architectury.dev/")
    maven("https://maven.minecraftforge.net/")
}

extensions.configure<net.fabricmc.loom.api.LoomGradleExtensionAPI>("loom") {
    forge {}
}

dependencies {
    minecraft("com.mojang:minecraft:$targetMcVersion")
    "forge"("net.minecraftforge:forge:$targetMcVersion-$forgeVersion")
    implementation("org.java-websocket:Java-WebSocket:${rootProject.property("java_websocket_version")}")
    include("org.java-websocket:Java-WebSocket:${rootProject.property("java_websocket_version")}")
}

base {
    archivesName.set("mct-client-mod-forge-$targetMcVersion")
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

tasks.withType<Jar>().configureEach {
    manifest {
        attributes("MixinConfigs" to "mct.mixins.json")
    }
}

tasks.processResources {
    val expandedProperties = mapOf(
        "version" to project.version.toString(),
        "mc_version" to targetMcVersion,
        "forge_version" to forgeVersion,
        "forge_major" to forgeMajor,
        "java_version" to javaVersion
    )

    inputs.properties(expandedProperties)

    filesMatching("META-INF/mods.toml") {
        expand(expandedProperties)
    }
}
