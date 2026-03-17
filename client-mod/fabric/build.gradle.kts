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
    implementation(project(":common"))
    include(project(":common"))
    include("org.java-websocket:Java-WebSocket:${rootProject.property("java_websocket_version")}")
}

loom {
    mixin {
        defaultRefmapName.set("mct.refmap.json")
    }
}

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
    sourceCompatibility = JavaVersion.toVersion(javaVersion)
    targetCompatibility = JavaVersion.toVersion(javaVersion)
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(javaVersion)
    options.encoding = "UTF-8"
}

base {
    archivesName.set("mct-client-mod-fabric-$mcVersion")
}
