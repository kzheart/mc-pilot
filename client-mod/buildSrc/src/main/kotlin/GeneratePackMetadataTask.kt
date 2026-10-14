import org.gradle.api.DefaultTask
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.CacheableTask
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.TaskAction

@CacheableTask
abstract class GeneratePackMetadataTask : DefaultTask() {
    @get:Input
    abstract val mcVersion: Property<String>

    @get:OutputFile
    abstract val outputFile: RegularFileProperty

    @TaskAction
    fun generate() {
        val metadata = ModPackMetadata.forMinecraftVersion(mcVersion.get())
        val file = outputFile.get().asFile
        file.parentFile.mkdirs()
        file.writeText(metadata)
    }
}
