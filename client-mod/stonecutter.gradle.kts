plugins {
    id("dev.kikugie.stonecutter")
    id("fabric-loom") version "1.6.12" apply false
}

stonecutter active "1.20.4-fabric" /* [SC] DO NOT EDIT */

stonecutter parameters {
    val loader = node.metadata.project.substringAfterLast('-')
    constants.match(loader, "fabric")
}
