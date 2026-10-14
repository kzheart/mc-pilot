package com.mojang.blaze3d.buffers;
import java.nio.ByteBuffer;
public class GpuBuffer {
    public static final int USAGE_MAP_READ = 1, USAGE_COPY_DST = 2;
    public static int live, maximum;
    public boolean closed;
    public GpuBuffer() { live++; maximum = Math.max(maximum, live); }
    public void close() { if (closed) throw new AssertionError("double close"); closed = true; live--; }
    public GpuBufferSlice.MappedView map(boolean read, boolean write) {
        if (closed) throw new AssertionError("mapped a closed buffer");
        if (com.mojang.blaze3d.systems.CommandEncoder.failMap) throw new IllegalStateException("map failed");
        com.mojang.blaze3d.systems.CommandEncoder.maps++;
        return new GpuBufferSlice.MappedView();
    }
    public static class MappedView implements AutoCloseable {
        private final ByteBuffer data = ByteBuffer.allocate(16);
        public MappedView() { for (int i = 0; i < 16; i++) data.put(i, (byte) i); }
        public ByteBuffer data() { return data; }
        public void close() {}
    }
}
