package com.mojang.blaze3d.systems;
import com.mojang.blaze3d.buffers.GpuBuffer;
import com.mojang.blaze3d.textures.GpuTexture;
import java.util.ArrayList;
import java.util.List;
public final class CommandEncoder {
    public static final List<Runnable> callbacks = new ArrayList<Runnable>();
    public static int maps;
    public static boolean failCopy, failMap;
    public void copyTextureToBuffer(GpuTexture texture, GpuBuffer buffer, long offset, Runnable ready, int mip) {
        if (failCopy) throw new IllegalStateException("copy failed");
        callbacks.add(ready);
    }
    public GpuBuffer.MappedView mapBuffer(GpuBuffer buffer, boolean read, boolean write) {
        if (buffer.closed) throw new AssertionError("mapped a closed buffer");
        if (failMap) throw new IllegalStateException("map failed");
        maps++; return new GpuBuffer.MappedView();
    }
    public static void complete() { callbacks.remove(0).run(); }
    public static void reset() { callbacks.clear(); maps = 0; failCopy = failMap = false; }
}
