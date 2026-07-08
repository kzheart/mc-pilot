plugins {
    id("dev.architectury.loom")
}

val targetMcVersion = project.property("mcVersion") as String
val neoforgeVersion: String by project
val javaVersion: String by project
val neoforgeMajor = neoforgeVersion.substringBefore(".")

version = rootProject.property("mod_version") as String
group = rootProject.property("maven_group") as String

repositories {
    mavenCentral()
    maven("https://maven.fabricmc.net/")
    maven("https://maven.architectury.dev/")
    maven("https://maven.neoforged.net/releases/")
}

dependencies {
    minecraft("com.mojang:minecraft:$targetMcVersion")
    "neoForge"("net.neoforged:neoforge:$neoforgeVersion")
    implementation("org.java-websocket:Java-WebSocket:${rootProject.property("java_websocket_version")}")
    include("org.java-websocket:Java-WebSocket:${rootProject.property("java_websocket_version")}")
}

base {
    archivesName.set("mct-client-mod-neoforge-$targetMcVersion")
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
        "neoforge_version" to neoforgeVersion,
        "neoforge_major" to neoforgeMajor,
        "java_version" to javaVersion
    )

    inputs.properties(expandedProperties)

    filesMatching("META-INF/neoforge.mods.toml") {
        expand(expandedProperties)
    }
}
