plugins {
    id("mct-version-module")
}

sourceSets.main {
    java.srcDir(rootProject.file("shared/java"))
    java.srcDir(rootProject.file("shared/mixin-common"))
    java.srcDir(rootProject.file("shared/mixin-chat-legacy"))
    java.srcDir(rootProject.file("shared/mixin-hud-legacy"))
    java.srcDir(rootProject.file("shared/mixin-sign-legacy"))
    java.srcDir(rootProject.file("shared/registries-legacy"))
    resources.srcDir(rootProject.file("shared/resources"))
}
