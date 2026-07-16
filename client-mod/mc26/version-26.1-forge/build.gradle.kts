plugins {
    id("mct-mc26-forge")
}

sourceSets.main {
    java.srcDir(rootProject.file("version-26.2/src/main/java"))
    java.srcDir(rootProject.file("../shared/java-official"))
    java.srcDir(rootProject.file("../shared/network-official"))
    java.srcDir(rootProject.file("../shared/registries-official"))
    java.srcDir(rootProject.file("../shared/mixin-common-official"))
    java.srcDir(rootProject.file("../shared/mixin-chat-official"))
    java.srcDir(rootProject.file("../shared/mixin-hud-official"))
    java.srcDir(rootProject.file("../shared/mixin-sign-official"))
    java.srcDir(rootProject.file("../shared/mixin-resourcepack-official"))
    java.srcDir(rootProject.file("../shared/forge-modern/java"))
    java.exclude("com/mct/platform/FabricEntrypoint.java")
    resources.srcDir(rootProject.file("../shared/forge/resources"))
    resources.srcDir(rootProject.file("version-26.2/src/main/resources"))
    resources.exclude("fabric.mod.json")
}
