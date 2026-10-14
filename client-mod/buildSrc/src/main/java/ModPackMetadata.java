/** Resource-only metadata shared by the modern and mc26 Loom build families. */
public final class ModPackMetadata {
    private ModPackMetadata() {}

    public static String forMinecraftVersion(String minecraftVersion) {
        // Minecraft's own version.json: pack_version.resource (or resource_major).
        // Do not use data-pack formats; they diverge from resource formats.
        int format = switch (minecraftVersion) {
            case "1.18.2" -> 8;
            case "1.20.1" -> 15;
            case "1.20.2" -> 18;
            case "1.20.4" -> 22;
            case "1.21.1" -> 34;
            case "1.21.4" -> 46;
            case "1.21.11" -> 75;
            case "26.1" -> 84;
            case "26.2" -> 88;
            default -> throw new IllegalArgumentException(
                "No client resource pack format registered for Minecraft " + minecraftVersion);
        };
        // Since 1.21.9, resource formats >= 65 require min_format/max_format.
        // https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21-9
        String range = format >= 65
            ? ",\n    \"min_format\": [" + format + ", 0],\n    \"max_format\": [" + format + ", 0]"
            : "";
        return "{\n  \"pack\": {\n"
            + "    \"description\": \"Minecraft Auto Test client mod resources\",\n"
            + "    \"pack_format\": " + format + range + "\n  }\n}\n";
    }
}
