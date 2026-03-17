plugins {
    id("dev.architectury.loom")
}

val mcVersion: String by rootProject.extra
val yarnMappings: String by rootProject.extra
val javaVersion: Int by rootProject.extra
val neoforgeVersion: String by rootProject.extra

loom {
    neoForge()
    mixin {
        defaultRefmapName.set("mct.refmap.json")
    }
}

dependencies {
    minecraft("com.mojang:minecraft:$mcVersion")
    mappings("net.fabricmc:yarn:$yarnMappings:v2")
    neoForge("net.neoforged:neoforge:$neoforgeVersion")
    implementation(project(":common"))
    include(project(":common"))
    include("org.java-websocket:Java-WebSocket:${rootProject.property("java_websocket_version")}")
}

java {
    sourceCompatibility = JavaVersion.toVersion(javaVersion)
    targetCompatibility = JavaVersion.toVersion(javaVersion)
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(javaVersion)
    options.encoding = "UTF-8"
}

base {
    archivesName.set("mct-client-mod-neoforge-$mcVersion")
}
