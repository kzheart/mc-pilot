import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class ModPackMetadataTest {
    public static void main(String[] args) throws Exception {
        Path output = Path.of(args[0]);
        String[] versions = {"1.18.2", "1.20.1", "1.20.2", "1.20.4", "1.21.1", "1.21.4", "1.21.11", "26.1", "26.2"};
        for (String version : versions) {
            String metadata = ModPackMetadata.forMinecraftVersion(version);
            if (!metadata.equals(ModPackMetadata.forMinecraftVersion(version))) {
                throw new AssertionError("Non-deterministic metadata: " + version);
            }
            Files.writeString(output.resolve(version + ".json"), metadata, StandardCharsets.UTF_8);
        }
        for (String unknown : new String[] {"1.20.3", "1.21.9", "1.12.2", "26.3", "", "future"}) {
            try {
                ModPackMetadata.forMinecraftVersion(unknown);
                throw new AssertionError("Accepted an unregistered version: " + unknown);
            } catch (IllegalArgumentException expected) {
                if (!expected.getMessage().contains(unknown)) throw new AssertionError(expected);
            }
        }
        System.out.println("Metadata renderer: 9 deterministic versions, 6 unknown-version negative controls passed");
    }
}
