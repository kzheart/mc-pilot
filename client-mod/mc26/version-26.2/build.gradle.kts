plugins {
    id("mct-mc26-fabric")
}

// mc26 构建的 rootProject 基准是 mc26/,指向 shared 需多一级 ../
sourceSets.main {
    java.srcDir(rootProject.file("../shared/java-official"))
    java.srcDir(rootProject.file("../shared/network-official"))
    java.srcDir(rootProject.file("../shared/registries-official"))
    java.srcDir(rootProject.file("../shared/mixin-common-official"))
    java.srcDir(rootProject.file("../shared/mixin-chat-official"))
    java.srcDir(rootProject.file("../shared/mixin-hud-official"))
    java.srcDir(rootProject.file("../shared/mixin-sign-official"))
    java.srcDir(rootProject.file("../shared/mixin-resourcepack-official"))
}
