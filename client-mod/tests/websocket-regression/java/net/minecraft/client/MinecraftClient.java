package net.minecraft.client;
/** Minimal compile-only game boundary; the production transport is compiled unchanged. */
public final class MinecraftClient {
    private static final MinecraftClient INSTANCE = new MinecraftClient();
    public static MinecraftClient getInstance() { return INSTANCE; }
}
