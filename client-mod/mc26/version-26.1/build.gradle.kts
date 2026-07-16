plugins {
    id("mct-mc26-fabric")
}

// 26.1 与 26.2 共用同一代 official API 适配，仍分别针对目标游戏版本编译验证。
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
    resources.srcDir(rootProject.file("version-26.2/src/main/resources"))
}
