plugins {
    id("mct-mc26-neoforge")
}

// 薄壳:复用 version-26.2 全部源码与 official 代际目录,仅替换入口与 loader 资源
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
    java.srcDir(rootProject.file("../shared/neoforge/java"))
    java.exclude("com/mct/platform/FabricEntrypoint.java")
    resources.srcDir(rootProject.file("../shared/neoforge/resources-toml-modern"))
    resources.srcDir(rootProject.file("version-26.2/src/main/resources"))
    resources.exclude("fabric.mod.json")
}
