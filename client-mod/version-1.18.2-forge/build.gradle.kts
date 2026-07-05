plugins {
    id("mct-forge-version-module")
}

sourceSets.main {
    java.srcDir(rootProject.file("version-1.18.2/src/main/java"))
    java.srcDir(rootProject.file("shared/java"))
    java.srcDir(rootProject.file("shared/network-legacy"))
    java.srcDir(rootProject.file("shared/forge/java"))
    java.srcDir(rootProject.file("shared/mixin-common"))
    java.srcDir(rootProject.file("shared/mixin-chat-legacy"))
    java.srcDir(rootProject.file("shared/mixin-hud-legacy"))
    java.srcDir(rootProject.file("shared/mixin-sign-legacy"))
    java.srcDir(rootProject.file("shared/registries-legacy"))
    java.exclude("com/mct/platform/FabricEntrypoint.java")
    resources.srcDir(rootProject.file("shared/forge/resources"))
    resources.srcDir(rootProject.file("version-1.18.2/src/main/resources"))
}
