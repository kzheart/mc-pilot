plugins {
    id("mct-version-module")
}

val transformedSharedJavaDir = layout.buildDirectory.dir("transformed-shared-java")
val filteredMixinCommonDir = layout.buildDirectory.dir("filtered-mixin-common")

val copyTransformedSharedJava by tasks.registering {
    val inputDir = rootProject.file("shared/java")
    inputs.dir(inputDir)
    outputs.dir(transformedSharedJavaDir)
    doLast {
        val outputDir = transformedSharedJavaDir.get().asFile
        delete(outputDir)
        inputDir.walkTopDown()
            .filter { it.isFile && it.extension == "java" }
            .forEach { file ->
                val target = outputDir.resolve(file.relativeTo(inputDir))
                target.parentFile.mkdirs()
                val transformed = file.readText()
                    .replace("import com.mct.mixin.KeyboardInvoker;", "import com.mct.version.invoker.KeyboardInvoker;")
                    .replace("import com.mct.mixin.MouseInvoker;", "import com.mct.version.invoker.MouseInvoker;")
                    .replace("requirePlayer().clientWorld", "((net.minecraft.client.world.ClientWorld) requirePlayer().getEntityWorld())")
                    .replace("player.clientWorld", "((net.minecraft.client.world.ClientWorld) player.getEntityWorld())")
                    .replace("requirePlayer().getPos()", "requirePlayer().getEntityPos()")
                    .replace("player.getPos()", "player.getEntityPos()")
                    .replace("player.getInventory().selectedSlot = slot;", "player.getInventory().setSelectedSlot(slot);")
                    .replace("player.getInventory().selectedSlot", "player.getInventory().getSelectedSlot()")
                    .replace("Direction.byName(", "Direction.byId(")
                    .replace("gameMode.getName()", "gameMode.getId()")
                    .replace("entry.getGameMode().getName()", "entry.getGameMode().getId()")
                    .replace("candidate.getProfile().getName()", "candidate.getProfile().name()")
                    .replace("entry.getProfile().getName()", "entry.getProfile().name()")
                    .replace(".getDifficulty().getName()", ".getLevelProperties().getDifficulty().getName()")
                    .replace(".getTime()", ".getTimeOfDay()")
                    .replace("ScreenshotRecorder.takeScreenshot(client.getFramebuffer())", "com.mct.version.impl.ScreenshotSupport.takeScreenshot(client.getFramebuffer())")
                    .replace(
                        "client.keyboard.onKey(client.getWindow().getHandle(), keyCode, scancode, action, 0);",
                        "((KeyboardInvoker) client.keyboard).mct${'$'}onKey(client.getWindow().getHandle(), keyCode, scancode, action, 0);"
                    )
                target.writeText(transformed)
            }
    }
}

val copyFilteredMixinCommon by tasks.registering(Sync::class) {
    from(rootProject.file("shared/mixin-common")) {
        exclude("com/mct/mixin/KeyboardInvoker.java", "com/mct/mixin/MouseInvoker.java")
    }
    into(filteredMixinCommonDir)
}

sourceSets.main {
    java.srcDir(transformedSharedJavaDir)
    java.srcDir(filteredMixinCommonDir)
    java.srcDir(rootProject.file("shared/mixin-chat-modern"))
    java.srcDir(rootProject.file("shared/mixin-hud-modern"))
    java.srcDir(rootProject.file("shared/mixin-sign-modern"))
    java.srcDir(rootProject.file("shared/mixin-resourcepack"))
    java.srcDir(rootProject.file("shared/registries-modern"))
    resources.srcDir(rootProject.file("shared/resources"))
}


tasks.named("compileJava") {
    dependsOn(copyTransformedSharedJava, copyFilteredMixinCommon)
}
