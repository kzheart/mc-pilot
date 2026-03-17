import groovy.json.JsonSlurper

val catalog = JsonSlurper().parseText(rootProject.file("variants.json").readText()) as Map<*, *>
val variants = catalog["variants"] as? List<Map<*, *>>
  ?: error("variants.json 缺少 variants")

val supportedVariants = variants
    .filter { variant ->
        variant["loader"]?.toString() == "fabric"
            && variant["yarnMappings"] != null
            && variant["fabricLoaderVersion"] != null
    }
    .map { variant -> variant["id"]?.toString() ?: error("variant id 缺失") }

extra["supportedVariants"] = supportedVariants
