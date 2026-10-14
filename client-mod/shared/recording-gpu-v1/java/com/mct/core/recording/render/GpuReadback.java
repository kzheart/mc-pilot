package com.mct.core.recording.render;

import com.mct.core.recording.RecordingController.Capture;
import com.mojang.blaze3d.buffers.GpuBuffer;

import com.mojang.blaze3d.systems.CommandEncoder;
import java.nio.ByteBuffer;

/** 1.21.11/26.1 map through the command encoder. */
final class GpuReadback {
    private GpuReadback() {}
    static void copy(CommandEncoder encoder, GpuBuffer buffer, Capture capture) {
        try (GpuBuffer.MappedView mapped = encoder.mapBuffer(buffer, true, false)) {
            ByteBuffer data = mapped.data();
            int stride = capture.width * 4;
            for (int y = 0; y < capture.height; y++) {
                data.position((capture.height - y - 1) * stride);
                data.get(capture.bytes, y * stride, stride);
            }
        }
    }
}
