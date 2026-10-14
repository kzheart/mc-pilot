#!/usr/bin/env python3
"""Check actual renderer output and the source projection, without running Gradle.

This guards each modern variant's resource inputs, not a claim about rebuilt jars.
The Gradle task and packaged jars are verified separately by packaging tests.
"""
import hashlib
import json
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[1]
output = Path(sys.argv[1])
expected_formats = {
    "1.18.2": 8, "1.20.1": 15, "1.20.2": 18, "1.20.4": 22,
    "1.21.1": 34, "1.21.4": 46, "1.21.11": 75,
    "26.1": 84, "26.2": 88,
}
description = "Minecraft Auto Test client mod resources"
for version, pack_format in expected_formats.items():
    metadata = json.loads((output / f"{version}.json").read_text())
    expected = {"description": description, "pack_format": pack_format}
    if pack_format >= 65:
        expected.update(min_format=[pack_format, 0], max_format=[pack_format, 0])
    assert metadata == {"pack": expected}, (version, metadata)

# Byte-for-byte preservation of the old 1.20.1 source resource, including newline.
old_1201 = ("{\n  \"pack\": {\n"
            f"    \"description\": \"{description}\",\n"
            "    \"pack_format\": 15\n  }\n}\n").encode()
assert (output / "1.20.1.json").read_bytes() == old_1201
print("1.20.1 preserved SHA-256:", hashlib.sha256(old_1201).hexdigest())

base = (root / "buildSrc/src/main/kotlin/mct-version-base.gradle.kts").read_text()
assert 'tasks.register<GeneratePackMetadataTask>("generatePackMetadata")' in base
assert 'mcVersion.set(targetMcVersion)' in base
assert 'generated/resources/pack/pack.mcmeta' in base
assert re.search(r'tasks\.processResources\s*\{\s*//[^\n]*\n\s*from\(generatePackMetadata\)', base)
assert re.search(r'filesMatching\("pack.mcmeta"\)\s*\{\s*duplicatesStrategy = DuplicatesStrategy.FAIL', base)
task = (root / "buildSrc/src/main/kotlin/GeneratePackMetadataTask.kt").read_text()
for required in ('@CacheableTask', '@get:Input', '@get:OutputFile', '@TaskAction',
                 'ModPackMetadata.forMinecraftVersion(mcVersion.get())', 'file.writeText(metadata)'):
    assert required in task, required

catalog = json.loads((root / "variants.json").read_text())["variants"]
settings = (root / "settings.gradle.kts").read_text()
assert 'extensions.extraProperties["mcVersion"] = variant["minecraftVersion"].toString()' in settings


def covered_variants(entries):
    modern = [v for v in entries if v.get("gradleModule") and not v.get("gradleBuild")]
    versions = set(v["minecraftVersion"] for v in modern)
    assert versions == set(expected_formats) - {"26.1", "26.2"}, ("unregistered or missing Minecraft version", versions)
    return modern


variants = covered_variants(catalog)
assert len(variants) == 20, len(variants)
for variant in variants:
    module = root / variant["gradleModule"]
    source = (module / "build.gradle.kts").read_text()
    plugin_name = re.search(r'id\("(mct-[\w-]+)"\)', source).group(1)
    plugin = (root / f"buildSrc/src/main/kotlin/{plugin_name}.gradle.kts").read_text()
    assert 'id("mct-version-base")' in plugin, variant["id"]
    directories = [module / "src/main/resources"]
    directories += [root / path for path in re.findall(r'resources.srcDir\(rootProject.file\("([^"]+)"\)\)', source)]
    existing = [directory / "pack.mcmeta" for directory in directories if (directory / "pack.mcmeta").exists()]
    assert not existing, (variant["id"], "duplicate metadata", existing)
    assert (output / f'{variant["minecraftVersion"]}.json').is_file(), variant["id"]
print(f"Source projection: {len(variants)} modern variants each receive exactly one generated pack.mcmeta")

# A future catalog entry must fail coverage rather than silently inherit a format.
unknown = dict(variants[0], minecraftVersion="1.999.0", id="1.999.0-fabric")
try:
    covered_variants(catalog + [unknown])
except AssertionError as expected:
    assert "1.999.0" in str(expected), expected
else:
    raise AssertionError("Projection accepted an injected unknown Minecraft version")
print("Source projection: unknown-version negative control passed")

mc26 = [v for v in catalog if v.get("gradleBuild") == "mc26" and v["loader"] in {"forge", "neoforge"}]
assert len(mc26) == 4, mc26
shared_build = (root / "mc26/buildSrc/build.gradle.kts").read_text()
assert 'java.srcDir(file("../../buildSrc/src/main/java"))' in shared_build
assert 'source(file("../../buildSrc/src/main/kotlin/GeneratePackMetadataTask.kt"))' in shared_build
convention = (root / "mc26/buildSrc/src/main/kotlin/mct-mc26-pack-metadata.gradle.kts").read_text()
for required in ('tasks.register<GeneratePackMetadataTask>("generatePackMetadata")',
                 'mcVersion.set(project.property("mcVersion") as String)',
                 'from(generatePackMetadata)', 'duplicatesStrategy = DuplicatesStrategy.FAIL'):
    assert required in convention, required
for variant in mc26:
    plugin = (root / f'mc26/buildSrc/src/main/kotlin/mct-mc26-{variant["loader"]}.gradle.kts').read_text()
    assert 'id("mct-mc26-pack-metadata")' in plugin, variant["id"]
    assert (output / f'{variant["minecraftVersion"]}.json').is_file(), variant["id"]
# Fabric is not scanned by Forge's resource-pack loader; legacy FML supplies its own pack metadata.
fabric = (root / "mc26/buildSrc/src/main/kotlin/mct-mc26-fabric.gradle.kts").read_text()
assert 'id("mct-mc26-pack-metadata")' not in fabric
print("Source projection: 4 mc26 Forge/NeoForge variants share the modern metadata generator")
