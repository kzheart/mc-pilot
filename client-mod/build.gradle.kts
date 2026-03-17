import groovy.json.JsonSlurper

plugins {
    id("fabric-loom") version "1.6.12"
    id("maven-publish")
}

val variantCatalog = JsonSlurper().parseText(rootProject.file("variants.json").readText()) as Map<*, *>
val variantEntries = variantCatalog["variants"] as? List<Map<*, *>>
  ?: error("variants.json 缺少 variants")
val defaultVariantId = variantCatalog["defaultVariant"]?.toString()
  ?: error("variants.json 缺少 defaultVariant")
val targetVariantId = (findProperty("target_variant") as String?) ?: defaultVariantId
val selectedVariant = variantEntries.firstOrNull { entry -> entry["id"]?.toString() == targetVariantId }
  ?: error("未知变体: $targetVariantId")

fun variantValue(key: String): String {
    return selectedVariant[key]?.toString()
      ?: error("变体 $targetVariantId 缺少字段 $key")
}

val loader = variantValue("loader")
require(loader == "fabric") {
    "当前 Fabric 工程只支持 fabric 变体，收到: $targetVariantId"
}

val minecraftVersion = variantValue("minecraftVersion")
val yarnMappings = variantValue("yarnMappings")
val fabricLoaderVersion = variantValue("fabricLoaderVersion")
val javaVersion = variantValue("javaVersion").toInt()

version = selectedVariant["modVersion"]?.toString() ?: project.property("mod_version") as String
group = project.property("maven_group") as String

base {
    archivesName.set("${project.property("archives_base_name") as String}-$targetVariantId")
}

loom {
    splitEnvironmentSourceSets()
    mixin {
        defaultRefmapName.set("mct.refmap.json")
    }

    mods {
        create("mct") {
            sourceSet(sourceSets.main.get())
            sourceSet(sourceSets.getByName("client"))
        }
    }
}

repositories {
    mavenCentral()
}

dependencies {
    minecraft("com.mojang:minecraft:$minecraftVersion")
    mappings("net.fabricmc:yarn:$yarnMappings:v2")
    modImplementation("net.fabricmc:fabric-loader:$fabricLoaderVersion")
    implementation("org.java-websocket:Java-WebSocket:${project.property("java_websocket_version")}")
    include("org.java-websocket:Java-WebSocket:${project.property("java_websocket_version")}")
}

tasks.processResources {
    inputs.property("version", project.version)
    inputs.property("minecraftVersion", minecraftVersion)
    inputs.property("fabricLoaderVersion", fabricLoaderVersion)
    inputs.property("javaVersion", javaVersion)

    filesMatching("fabric.mod.json") {
        expand(
            "version" to project.version,
            "minecraft_version_range" to "~$minecraftVersion",
            "fabric_loader_version" to fabricLoaderVersion,
            "java_version" to javaVersion
        )
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(javaVersion)
    options.encoding = "UTF-8"
}

java {
    withSourcesJar()
    sourceCompatibility = JavaVersion.toVersion(javaVersion)
    targetCompatibility = JavaVersion.toVersion(javaVersion)
}

tasks.register("printVariantInfo") {
    doLast {
        println("variant=$targetVariantId")
        println("minecraftVersion=$minecraftVersion")
        println("yarnMappings=$yarnMappings")
        println("fabricLoaderVersion=$fabricLoaderVersion")
        println("javaVersion=$javaVersion")
        println("archivesName=${base.archivesName.get()}")
    }
}
