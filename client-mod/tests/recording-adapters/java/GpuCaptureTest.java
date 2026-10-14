import com.mct.core.recording.RecordingController;
import com.mct.core.recording.render.GpuCapture;
import com.mojang.blaze3d.buffers.GpuBuffer;
import com.mojang.blaze3d.systems.CommandEncoder;
import com.mojang.blaze3d.textures.GpuTexture;
import java.nio.file.Paths;

public final class GpuCaptureTest {
    static final RecordingController C = RecordingController.getInstance();
    static void frame(GpuCapture gpu) { gpu.onFrame(Paths.get("."), new GpuTexture(), 2, 2, 60); }
    static void check(boolean ok, String detail) { if (!ok) throw new AssertionError(detail); }
    static void released() {
        for (RecordingController.Capture c : C.captures) check(c.released, "leaked frame ownership");
    }
    static void reset() { C.reset(); CommandEncoder.reset(); check(GpuBuffer.live == 0, "previous test leaked GPU memory"); }
    public static void main(String[] args) throws Exception {
        reset(); GpuCapture g = new GpuCapture(); frame(g);
        check(GpuBuffer.live == 0, "idle allocation"); C.start(); frame(g); frame(g);
        check(CommandEncoder.maps == 0 && CommandEncoder.callbacks.size() == 1, "mapped before GPU callback");
        check(C.busyDrops == 1 && C.released == 1, "busy readback leaked borrowed frame");
        CommandEncoder.complete(); check(C.submitted == 1, "callback did not submit frame");
        byte[] image = C.captures.get(0).bytes;
        for (int i = 0; i < 8; i++) check(image[i] == i + 8 && image[i + 8] == i, "rows not vertically flipped");
        frame(g); C.active = false; frame(g);
        check(GpuBuffer.live == 0 && !C.allocated && C.readbackPending, "stop did not release allocation/retain fence ticket");
        CommandEncoder.complete(); check(!C.readbackPending, "retired fence ticket not cleared");
        check(CommandEncoder.maps == 1, "late callback mapped canceled buffer"); released();

        reset(); g = new GpuCapture(); C.start(); frame(g);
        C.active = false; C.start(); frame(g);
        check(GpuBuffer.live == 0 && CommandEncoder.callbacks.size() == 1, "restart issued a second in-flight transfer");
        CommandEncoder.complete(); check(C.active && CommandEncoder.maps == 0, "old callback damaged new session");
        frame(g); CommandEncoder.complete(); C.active = false; frame(g); released();
        check(GpuBuffer.maximum <= 1, "unbounded readback allocation");

        reset(); g = new GpuCapture(); C.start(); frame(g);
        for (int i = 0; i < 20; i++) {
            C.active = false; frame(g); C.start(); frame(g);
            check(CommandEncoder.callbacks.size() == 1 && GpuBuffer.live == 0,
                "stuck canceled callback retained another transfer");
        }
        released(); CommandEncoder.complete(); C.active = false; frame(g);

        reset(); g = new GpuCapture(); C.start(); frame(g);
        java.lang.reflect.Field pending = GpuCapture.class.getDeclaredField("pending"); pending.setAccessible(true);
        Object request = pending.get(g);
        java.lang.reflect.Field capturedAt = request.getClass().getDeclaredField("capturedAt"); capturedAt.setAccessible(true);
        capturedAt.setLong(request, System.nanoTime() - 6_000_000_000L);
        frame(g); check(C.failures == 1 && GpuBuffer.live == 0, "stalled GPU was not bounded");
        CommandEncoder.complete(); released();

        for (boolean mapFailure : new boolean[] {false, true}) {
            reset(); g = new GpuCapture(); C.start(); CommandEncoder.failCopy = !mapFailure; frame(g);
            if (mapFailure) { CommandEncoder.failMap = true; CommandEncoder.complete(); }
            check(!C.active && C.failures == 1 && GpuBuffer.live == 0, "readback failure not cleaned");
            released(); g.close();
        }
        System.out.println("GpuCaptureTest: fenced map, row orientation, bounded memory, stop/restart and error cleanup passed");
    }
}
