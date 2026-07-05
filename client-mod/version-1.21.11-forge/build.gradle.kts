plugins {
    id("mct-forge-version-module")
}

val filteredMixinCommonDir = layout.buildDirectory.dir("filtered-mixin-common")

val copyFilteredMixinCommon by tasks.registering(Sync::class) {
    from(rootProject.file("shared/mixin-common")) {
        exclude("com/mct/mixin/KeyboardInvoker.java", "com/mct/mixin/MouseInvoker.java")
    }
    into(filteredMixinCommonDir)
}

sourceSets.main {
    java.srcDir(rootProject.file("version-1.21.11/src/main/java"))
    java.srcDir(rootProject.file("shared/java"))
    java.srcDir(rootProject.file("shared/network-common"))
    java.srcDir(rootProject.file("shared/forge-modern/java"))
    java.srcDir(filteredMixinCommonDir)
    java.srcDir(rootProject.file("shared/mixin-chat-modern"))
    java.srcDir(rootProject.file("shared/mixin-hud-modern"))
    java.srcDir(rootProject.file("shared/mixin-sign-modern"))
    java.srcDir(rootProject.file("shared/mixin-resourcepack"))
    java.srcDir(rootProject.file("shared/registries-modern"))
    java.exclude("com/mct/platform/FabricEntrypoint.java")
    resources.srcDir(rootProject.file("shared/forge/resources"))
    resources.srcDir(rootProject.file("version-1.21.11/src/main/resources"))
}

tasks.named("compileJava") {
    dependsOn(copyFilteredMixinCommon)
}
