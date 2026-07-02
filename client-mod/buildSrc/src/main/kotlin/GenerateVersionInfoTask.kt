import org.gradle.api.DefaultTask
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.TaskAction

abstract class GenerateVersionInfoTask : DefaultTask() {
    @get:Input
    abstract val mcVersion: Property<String>

    @get:OutputFile
    abstract val outputFile: RegularFileProperty

    @TaskAction
    fun generate() {
        val file = outputFile.get().asFile
        file.parentFile.mkdirs()
        file.writeText(
            """
            package com.mct.version.generated;

            public final class TargetVariant {
                public static final String MC_VERSION = "${mcVersion.get()}";
                private TargetVariant() {}
            }
            """.trimIndent()
        )
    }
}
