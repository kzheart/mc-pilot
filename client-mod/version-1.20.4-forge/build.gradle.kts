plugins {
    id("mct-forge-version-module")
}

sourceSets.main {
    java.srcDir(rootProject.file("version-1.20.4/src/main/java"))
    java.srcDir(rootProject.file("shared/java"))
    java.srcDir(rootProject.file("shared/forge/java"))
    java.srcDir(rootProject.file("shared/mixin-common"))
    java.srcDir(rootProject.file("shared/mixin-chat-modern"))
    java.srcDir(rootProject.file("shared/mixin-hud-modern"))
    java.srcDir(rootProject.file("shared/mixin-sign-modern"))
    java.srcDir(rootProject.file("shared/mixin-resourcepack"))
    java.srcDir(rootProject.file("shared/registries-modern"))
    java.exclude("com/mct/platform/FabricEntrypoint.java")
    resources.srcDir(rootProject.file("shared/forge/resources"))
    resources.srcDir(rootProject.file("version-1.20.4/src/main/resources"))
}
