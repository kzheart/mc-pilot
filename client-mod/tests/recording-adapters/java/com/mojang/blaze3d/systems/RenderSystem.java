package com.mojang.blaze3d.systems;
import com.mojang.blaze3d.buffers.GpuBuffer;
import java.util.function.Supplier;
public final class RenderSystem {
    private static final Device DEVICE = new Device();
    public static Device getDevice() { return DEVICE; }
    public static final class Device {
        public GpuBuffer createBuffer(Supplier<String> label, int flags, int size) { return new GpuBuffer(); }
        public CommandEncoder createCommandEncoder() { return new CommandEncoder(); }
    }
}
