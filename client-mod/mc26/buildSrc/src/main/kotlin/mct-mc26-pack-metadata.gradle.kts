plugins {
    java
}

val generatePackMetadata = tasks.register<GeneratePackMetadataTask>("generatePackMetadata") {
    mcVersion.set(project.property("mcVersion") as String)
    outputFile.set(layout.buildDirectory.file("generated/resources/pack/pack.mcmeta"))
}

tasks.processResources {
    from(generatePackMetadata)
    filesMatching("pack.mcmeta") {
        duplicatesStrategy = DuplicatesStrategy.FAIL
    }
}
