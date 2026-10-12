package com.mct.legacy;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;

public final class LegacyResourcePackUrlsTest {
    private static int checks;
    public static void main(String[] args) throws Exception {
        LegacyResourcePackUrls.validate("https://example.invalid/pack.zip");
        LegacyResourcePackUrls.validate("http://localhost:8123/pack.zip");
        LegacyResourcePackUrls.validate("level://World/resources.zip");
        reject(() -> LegacyResourcePackUrls.validate("file:///etc/resources.zip"));
        reject(() -> LegacyResourcePackUrls.validate("ftp://example.invalid/pack.zip"));
        reject(() -> LegacyResourcePackUrls.validate("javascript:alert(1)"));
        reject(() -> LegacyResourcePackUrls.validate("level://../resources.zip"));
        reject(() -> LegacyResourcePackUrls.validate("level://World/other.zip"));
        Path game = Files.createTempDirectory("mct-pack-urls-");
        try {
            Path world = Files.createDirectories(game.resolve("saves/World"));
            Files.createFile(world.resolve("resources.zip"));
            File found = LegacyResourcePackUrls.localPack(game.toFile(), "level://World/resources.zip");
            if (!found.isFile()) throw new AssertionError("Valid local pack missing");
            checks++;
            Files.createFile(game.resolve("resources.zip"));
            reject(() -> LegacyResourcePackUrls.localPack(game.toFile(), "level://%2e%2e/resources.zip"));
            reject(() -> LegacyResourcePackUrls.localPack(game.toFile(), "level://Missing/resources.zip"));
            Files.createSymbolicLink(game.resolve("saves/escape"), game);
            reject(() -> LegacyResourcePackUrls.localPack(game.toFile(), "level://escape/resources.zip"));
        } finally {
            Files.deleteIfExists(game.resolve("saves/escape"));
            Files.deleteIfExists(game.resolve("saves/World/resources.zip"));
            Files.deleteIfExists(game.resolve("saves/World"));
            Files.deleteIfExists(game.resolve("saves"));
            Files.deleteIfExists(game.resolve("resources.zip"));
            Files.deleteIfExists(game);
        }
        System.out.println("Legacy URL security checks passed: " + checks);
    }
    private static void reject(Checked task) throws Exception {
        try { task.run(); } catch (Exception expected) { checks++; return; }
        throw new AssertionError("Unsafe or invalid URL was accepted");
    }
    private interface Checked { void run() throws Exception; }
}
