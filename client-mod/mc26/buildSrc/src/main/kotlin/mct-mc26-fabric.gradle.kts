plugins {
    id("dev.architectury.loom")
}

val targetMcVersion = project.property("mcVersion") as String
val fabricLoader: String by project
val javaVersion: String by project

version = rootProject.property("mod_version") as String
group = rootProject.property("maven_group") as String

repositories {
    mavenCentral()
    maven("https://maven.fabricmc.net/")
}

dependencies {
    minecraft("com.mojang:minecraft:$targetMcVersion")
    // 26.x 无混淆:Loom disableObfuscation 模式下不注册 mod* remap 配置,直接用 implementation
    implementation("net.fabricmc:fabric-loader:$fabricLoader")
    implementation("org.java-websocket:Java-WebSocket:${rootProject.property("java_websocket_version")}")
    include("org.java-websocket:Java-WebSocket:${rootProject.property("java_websocket_version")}")
}

loom {
    mixin {
        defaultRefmapName.set("mct.refmap.json")
    }
}

base {
    archivesName.set("mct-client-mod-fabric-$targetMcVersion")
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

tasks.processResources {
    val expandedProperties = mapOf(
        "version" to project.version.toString(),
        "mc_version" to targetMcVersion,
        "fabric_loader" to fabricLoader,
        "java_version" to javaVersion
    )

    inputs.properties(expandedProperties)

    filesMatching("fabric.mod.json") {
        expand(expandedProperties)
    }
}
