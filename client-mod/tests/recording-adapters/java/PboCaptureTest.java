import com.mct.core.recording.RecordingController;
import com.mct.core.recording.render.PboCapture;
import java.nio.file.Paths;
import java.util.HashSet;
import java.util.Set;

public final class PboCaptureTest {
    static final RecordingController C = RecordingController.getInstance();
    static final class Driver implements PboCapture.Driver {
        int created, fences, maps, maxBuffers;
        boolean ready, failCopy, failEnqueue, failDelete;
        final Set<Integer> buffers = new HashSet<Integer>();
        final Set<Object> pending = new HashSet<Object>();
        final Set<Object> readyFences = new HashSet<Object>();
        public int create(int bytes) { buffers.add(++created); maxBuffers = Math.max(maxBuffers, buffers.size()); return created; }
        public Object enqueue(int buffer, int fbo, int w, int h) {
            if (failEnqueue) throw new IllegalStateException("enqueue");
            Object fence = Integer.valueOf(++fences); pending.add(fence); return fence;
        }
        public boolean ready(Object fence) { return ready || readyFences.contains(fence); }
        public void copy(int buffer, byte[] bytes, int w, int h) {
            if (!ready && readyFences.isEmpty()) throw new AssertionError("mapped before fence readiness");
            if (failCopy) throw new IllegalStateException("map");
            maps++;
        }
        public void deleteFence(Object fence) { pending.remove(fence); if (failDelete) throw new IllegalStateException("lost context"); }
        public void deleteBuffer(int buffer) { buffers.remove(buffer); if (failDelete) throw new IllegalStateException("lost context"); }
    }
    static void frame(PboCapture pbo) { pbo.onFrame(Paths.get("."), 3, 2, 2, 60); }
    static void check(boolean ok, String detail) { if (!ok) throw new AssertionError(detail); }
    static void released() {
        for (RecordingController.Capture c : C.captures) check(c.released, "leaked frame ownership");
    }
    public static void main(String[] args) throws Exception {
        C.reset(); Driver d = new Driver(); PboCapture p = new PboCapture(d);
        frame(p); check(d.created == 0, "idle capture allocated GPU memory");
        C.start(); frame(p); frame(p); frame(p);
        check(d.created == 2 && d.maps == 0, "pipeline must be bounded and nonblocking");
        check(C.released == 1 && C.busyDrops == 1, "saturation must release borrowed bytes");
        d.ready = true; frame(p);
        check(C.submitted == 2, "ready frames not submitted");
        check(C.submittedTimes.get(0) <= C.submittedTimes.get(1), "out-of-order timestamps");
        C.active = false; frame(p);
        check(d.buffers.isEmpty() && d.pending.isEmpty(), "stop leaked GPU resources"); released();

        C.reset(); d = new Driver(); p = new PboCapture(d); C.start(); frame(p);
        C.active = false; C.start(); frame(p); // An older generation is in flight.
        d.ready = true; frame(p); C.active = false; frame(p); released();
        check(C.submitted == 1, "stale session submitted a frame");
        check(d.maxBuffers <= 2, "unbounded buffers across sessions");

        C.reset(); d = new Driver(); p = new PboCapture(d); C.start(); frame(p); frame(p);
        d.readyFences.add(Integer.valueOf(1)); frame(p); // Slot zero is reused while slot one is older.
        d.ready = true; frame(p);
        for (int i = 1; i < C.submittedTimes.size(); i++)
            check(C.submittedTimes.get(i - 1) <= C.submittedTimes.get(i), "ring reuse reordered frames");
        C.active = false; frame(p); released();

        C.reset(); d = new Driver(); p = new PboCapture(d); C.start(); frame(p);
        java.lang.reflect.Field slots = PboCapture.class.getDeclaredField("slots"); slots.setAccessible(true);
        Object slot = ((Object[]) slots.get(p))[0];
        java.lang.reflect.Field capturedAt = slot.getClass().getDeclaredField("capturedAt"); capturedAt.setAccessible(true);
        capturedAt.setLong(slot, System.nanoTime() - 6_000_000_000L);
        frame(p); check(C.failures == 1 && d.buffers.isEmpty(), "stalled GPU was not bounded"); released();

        for (String failure : new String[] {"enqueue", "copy", "delete"}) {
            C.reset(); d = new Driver(); p = new PboCapture(d); C.start();
            d.failEnqueue = failure.equals("enqueue"); frame(p);
            if (failure.equals("copy")) { d.ready = true; d.failCopy = true; frame(p); }
            if (failure.equals("delete")) { d.failDelete = true; C.active = false; frame(p); }
            p.close(); released();
            check(d.buffers.isEmpty(), failure + " leaked a GPU buffer");
        }
        System.out.println("PboCaptureTest: bounded buffers, nonblocking fences, stale sessions and failure cleanup passed");
    }
}
