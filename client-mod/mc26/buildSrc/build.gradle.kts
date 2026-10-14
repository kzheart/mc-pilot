plugins {
    `kotlin-dsl`
}

repositories {
    gradlePluginPortal()
    maven("https://maven.fabricmc.net/")
    maven("https://maven.architectury.dev/")
    maven("https://maven.minecraftforge.net/")
    maven("https://maven.neoforged.net/releases/")
}

dependencies {
    implementation("dev.architectury.loom:dev.architectury.loom.gradle.plugin:1.17.487")
}

// Reuse the same renderer and cacheable task as the modern build, without copies.
sourceSets.main {
    java.srcDir(file("../../buildSrc/src/main/java"))
}
tasks.named<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>("compileKotlin") {
    source(file("../../buildSrc/src/main/kotlin/GeneratePackMetadataTask.kt"))
}
