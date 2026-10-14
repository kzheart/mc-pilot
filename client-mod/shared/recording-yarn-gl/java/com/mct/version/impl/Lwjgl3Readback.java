package com.mct.version.impl;

import com.mct.core.recording.render.PboCapture;
import java.nio.ByteBuffer;
import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL15;
import org.lwjgl.opengl.GL21;
import org.lwjgl.opengl.GL30;
import org.lwjgl.opengl.GL32;

/** Only issues asynchronous pixel transfers and maps buffers after a nonblocking fence poll. */
final class Lwjgl3Readback implements PboCapture.Driver {
    public int create(int bytes) {
        int old = GL11.glGetInteger(GL21.GL_PIXEL_PACK_BUFFER_BINDING);
        int buffer = GL15.glGenBuffers();
        try {
            GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER, buffer);
            GL15.glBufferData(GL21.GL_PIXEL_PACK_BUFFER, bytes, GL15.GL_STREAM_READ);
            return buffer;
        } catch (Throwable failure) { GL15.glDeleteBuffers(buffer); throw failure; }
        finally { GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER, old); }
    }
    public Object enqueue(int buffer, int framebuffer, int width, int height) {
        int oldFramebuffer = GL11.glGetInteger(GL30.GL_READ_FRAMEBUFFER_BINDING);
        int oldBuffer = GL11.glGetInteger(GL21.GL_PIXEL_PACK_BUFFER_BINDING);
        int alignment = GL11.glGetInteger(GL11.GL_PACK_ALIGNMENT);
        int rowLength = GL11.glGetInteger(GL11.GL_PACK_ROW_LENGTH);
        int skipRows = GL11.glGetInteger(GL11.GL_PACK_SKIP_ROWS);
        int skipPixels = GL11.glGetInteger(GL11.GL_PACK_SKIP_PIXELS);
        GL30.glBindFramebuffer(GL30.GL_READ_FRAMEBUFFER, framebuffer);
        int oldReadBuffer = GL11.glGetInteger(GL11.GL_READ_BUFFER);
        try {
            GL11.glReadBuffer(GL30.GL_COLOR_ATTACHMENT0);
            GL11.glPixelStorei(GL11.GL_PACK_ALIGNMENT, 1);
            GL11.glPixelStorei(GL11.GL_PACK_ROW_LENGTH, 0);
            GL11.glPixelStorei(GL11.GL_PACK_SKIP_ROWS, 0);
            GL11.glPixelStorei(GL11.GL_PACK_SKIP_PIXELS, 0);
            GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER, buffer);
            GL11.glReadPixels(0, 0, width, height, GL11.GL_RGBA, GL11.GL_UNSIGNED_BYTE, 0L);
            long fence = GL32.glFenceSync(GL32.GL_SYNC_GPU_COMMANDS_COMPLETE, 0);
            if (fence == 0L) throw new IllegalStateException("GPU did not create a readback fence");
            return Long.valueOf(fence);
        } finally {
            GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER, oldBuffer);
            GL11.glPixelStorei(GL11.GL_PACK_ALIGNMENT, alignment);
            GL11.glPixelStorei(GL11.GL_PACK_ROW_LENGTH, rowLength);
            GL11.glPixelStorei(GL11.GL_PACK_SKIP_ROWS, skipRows);
            GL11.glPixelStorei(GL11.GL_PACK_SKIP_PIXELS, skipPixels);
            GL11.glReadBuffer(oldReadBuffer);
            GL30.glBindFramebuffer(GL30.GL_READ_FRAMEBUFFER, oldFramebuffer);
        }
    }
    public boolean ready(Object fence) {
        int state = GL32.glClientWaitSync(((Long) fence).longValue(), 0, 0L);
        if (state == GL32.GL_WAIT_FAILED) throw new IllegalStateException("GPU readback fence failed");
        return state == GL32.GL_ALREADY_SIGNALED || state == GL32.GL_CONDITION_SATISFIED;
    }
    public void copy(int buffer, byte[] bytes, int width, int height) {
        int old = GL11.glGetInteger(GL21.GL_PIXEL_PACK_BUFFER_BINDING);
        GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER, buffer);
        try {
            ByteBuffer data = GL15.glMapBuffer(GL21.GL_PIXEL_PACK_BUFFER, GL15.GL_READ_ONLY, bytes.length, null);
            if (data == null) throw new IllegalStateException("GPU readback map failed");
            boolean valid;
            try {
                int stride = width * 4;
                for (int y = 0; y < height; y++) {
                    data.position((height - y - 1) * stride);
                    data.get(bytes, y * stride, stride);
                }
            } finally { valid = GL15.glUnmapBuffer(GL21.GL_PIXEL_PACK_BUFFER); }
            if (!valid) throw new IllegalStateException("GPU readback buffer became invalid");
        } finally { GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER, old); }
    }
    public void deleteFence(Object fence) { GL32.glDeleteSync(((Long) fence).longValue()); }
    public void deleteBuffer(int buffer) { GL15.glDeleteBuffers(buffer); }
}
