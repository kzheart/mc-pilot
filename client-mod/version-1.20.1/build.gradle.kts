plugins {
    id("mct-version-module")
}

sourceSets.main {
    java.srcDir(rootProject.file("shared/java"))
    java.srcDir(rootProject.file("shared/mixin-common"))
    java.srcDir(rootProject.file("shared/mixin-chat-modern"))
    java.srcDir(rootProject.file("shared/mixin-hud-modern"))
    java.srcDir(rootProject.file("shared/mixin-sign-legacy"))
    java.srcDir(rootProject.file("shared/registries-modern"))
    resources.srcDir(rootProject.file("shared/resources"))
}
