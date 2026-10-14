package com.mct.core.recording;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/** Standalone Java 8 regression suite: no game, display, dependencies or network. */
public final class RecordingCoreTest {
    private static int passed;
    private static Path directory;
    private static String realFfmpeg;
    interface Checked { void run() throws Exception; }
    static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private static void test(String name, Checked body) throws Exception {
        System.setProperty("mct.record.ffmpeg", realFfmpeg);
        body.run(); passed++; System.out.println("PASS " + name);
    }
    private static Map<String, Object> args(Object... pairs) {
        Map<String, Object> map = new HashMap<String, Object>();
        for (int i = 0; i < pairs.length; i += 2) map.put((String) pairs[i], pairs[i + 1]);
        return map;
    }
    private static Map<String, Object> small(String name) { return args("name", name, "width", 32, "height", 24, "fps", 30); }
    private static void expectCode(String expected, Checked body) throws Exception {
        try { body.run(); throw new AssertionError("Expected " + expected); }
        catch (RecordingController.RecordingException e) { check(expected.equals(e.getCode()), e.getCode() + ": " + e.getMessage()); }
    }
    private static void expectIllegal(Checked body) throws Exception {
        try { body.run(); throw new AssertionError("Expected IllegalArgumentException"); }
        catch (IllegalArgumentException expected) { }
    }
    private static void capture(RawFrameRecorder r, int red, int green, int blue) {
        byte[] bytes = r.acquireFrame(); check(bytes != null, "Frame unavailable"); paint(bytes, red, green, blue);
        check(r.submitFrame(bytes, System.nanoTime()), "Submission rejected");
    }
    private static void paint(byte[] bytes, int red, int green, int blue) {
        for (int i = 0; i < bytes.length; i += 4) { bytes[i] = (byte) red; bytes[i+1] = (byte) green; bytes[i+2] = (byte) blue; bytes[i+3] = (byte) 255; }
    }
    private static void awaitTerminal(RawFrameRecorder r, long millis) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(millis);
        while (System.nanoTime() < deadline) {
            RawFrameRecorder.State state = r.snapshot().state;
            if (state == RawFrameRecorder.State.FAILED || state == RawFrameRecorder.State.STOPPED) return;
            Thread.sleep(5);
        }
        throw new AssertionError("Not terminal: " + r.snapshot().toMap());
    }
    private static RawFrameRecorder.Limits limits(long durationMs, long firstMs, long stallMs, long finishMs) {
        return new RawFrameRecorder.Limits(TimeUnit.MILLISECONDS.toNanos(durationMs), firstMs, stallMs, finishMs, 0, RawFrameRecorder.MAX_OUTPUT_BYTES);
    }
    private static Path fake(String name, String content) throws IOException {
        Path path = directory.resolve(name + ".sh");
        Files.write(path, ("#!/bin/sh\n" + content + "\n").getBytes(StandardCharsets.UTF_8));
        check(path.toFile().setExecutable(true), "Cannot make test stub executable"); return path;
    }
    public static void main(String[] argv) throws Exception {
        directory = Paths.get(argv[0]).toAbsolutePath(); Files.createDirectories(directory);
        realFfmpeg = RawFrameRecorder.ffmpegExecutable().toString();
        test("integer CFR boundaries and long-duration arithmetic", new Checked() { public void run() {
            check(FrameTimeline.count(0, 30) == 1, "Zero length has one first frame");
            check(FrameTimeline.slot(999999999L, 30) == 29, "Floor before one second");
            check(FrameTimeline.count(1000000000L, 30) == 30, "Exact one second");
            check(FrameTimeline.count(1000000001L, 30) == 31, "Ceiling after one second");
            check(FrameTimeline.count(7200L * 1000000000L, 120) == 864000, "Long recording overflow");
            for (int fps : new int[] {1, 24, 30, 60, 120}) for (long n = 0; n < 5000; n++) {
                long elapsed = n * 987654L;
                check(FrameTimeline.count(elapsed, fps) == Math.max(1L, (elapsed * fps + 999999999L) / 1000000000L), "CFR rounding");
            }
        }});
        test("dimensions, memory and numeric validation", new Checked() { public void run() throws Exception {
            RawFrameRecorder.validateDimensions(3840, 2160, 60);
            expectIllegal(new Checked() { public void run() { RawFrameRecorder.validateDimensions(7680, 4320, 30); }});
            expectIllegal(new Checked() { public void run() { RawFrameRecorder.validateDimensions(1919, 1080, 30); }});
            expectIllegal(new Checked() { public void run() { RawFrameRecorder.validateDimensions(32, 24, 121); }});
            final RecordingController c = new RecordingController(); c.updateSource(directory, 32, 24, 60);
            for (final Object bad : new Object[] {0, 121, -1, 29.5, Double.NaN, Double.POSITIVE_INFINITY, "30", null})
                expectCode("INVALID_PARAMS", new Checked() { public void run() { Map<String,Object> m = small("numeric"); m.put("fps", bad); c.handle("recording.start", m); }});
            expectCode("RECORDING_FRAMEBUFFER_MISMATCH", new Checked() { public void run() { c.handle("recording.start", args("name", "default")); }});
            Map<?, ?> detail = (Map<?, ?>) c.status().get("lastControlError");
            check(detail.get("message").toString().contains("32x24") && detail.get("message").toString().contains("--width 1920 --height 1080"), "Actionable dimensions missing");
        }});
        test("safe names, unknown fields, native-source guards", new Checked() { public void run() throws Exception {
            final RecordingController c = new RecordingController();
            expectCode("RECORDING_SOURCE_UNAVAILABLE", new Checked() { public void run() { c.handle("recording.start", small("nosource")); }});
            c.updateSource(directory, 32, 24);
            for (final String name : new String[] {"../escape", "a/b", "a\\b", "hidden.mp4", ".hidden", "CON", "nul", "COM1", "LPT9", "", " name", "-name", "name\n"})
                expectCode("INVALID_PARAMS", new Checked() { public void run() { c.handle("recording.start", small(name)); }});
            for (final String field : new String[] {"ffmpeg", "executable", "outputPath", "directory", "native", "audio"})
                expectCode("INVALID_PARAMS", new Checked() { public void run() { Map<String,Object> m = small("unsafe"); m.put(field, "anything"); c.handle("recording.start", m); }});
            expectCode("INVALID_PARAMS", new Checked() { public void run() { c.handle("recording.status", args("ffmpeg", "/bin/sh")); }});
            expectCode("RECORDING_NOT_STARTED", new Checked() { public void run() { c.handle("recording.stop", null); }});
        }});
        test("executable resolution is launch-only and never shell-evaluated", new Checked() { public void run() throws Exception {
            for (String value : new String[] {"", "sh -c touch sentinel", "http://host/encoder", "relative/ffmpeg", "/missing/ffmpeg"}) {
                System.setProperty("mct.record.ffmpeg", value);
                try { RawFrameRecorder.ffmpegExecutable(); throw new AssertionError("Unsafe/missing executable accepted: " + value); }
                catch (IOException expected) { }
            }
            final RecordingController c = new RecordingController(); c.updateSource(directory, 32, 24);
            expectCode("RECORDING_FFMPEG_UNAVAILABLE", new Checked() { public void run() { c.handle("recording.start", small("missing")); }});
            check(Boolean.FALSE.equals(((Map<?,?>)c.status().get("capabilities")).get("ffmpegAvailable")), "Availability falsely true");
        }});
        test("real sparse captures preserve wall duration and CFR duplicates", new Checked() { public void run() throws Exception {
            RawFrameRecorder r = RawFrameRecorder.start(directory.resolve("cfr.mp4"), 32, 24, 30);
            Thread.sleep(110); capture(r, 220, 30, 10);
            Thread.sleep(260); capture(r, 10, 220, 30);
            Thread.sleep(480); capture(r, 10, 30, 220);
            Thread.sleep(280);
            RawFrameRecorder.Snapshot s = r.stop(5000);
            check(s.finalized, "CFR not finalized: " + s.toMap());
            check(s.captured == 3 && s.duplicate == s.encoded - 3, "Sparse capture counters: " + s.toMap());
            check(s.encoded == (long) Math.ceil(s.elapsedSeconds * 30), "Duration compressed: " + s.toMap());
            check(s.firstFrameWaitSeconds >= .10, "Initial delay not measured");
            check(r.stop(20).finalized && r.acquireFrame() == null, "Stop not idempotent");
            Files.write(directory.resolve("cfr-expected.txt"), (s.encoded + "\n" + s.elapsedSeconds + "\n").getBytes(StandardCharsets.UTF_8));
        }});
        test("pool pressure and frame ownership stay bounded", new Checked() { public void run() throws Exception {
            final RawFrameRecorder r = RawFrameRecorder.start(directory.resolve("pool.mp4"), 32, 24, 30);
            final byte[][] buffers = new byte[RawFrameRecorder.POOL_SIZE][];
            for (int i=0; i<buffers.length; i++) { buffers[i] = r.acquireFrame(); check(buffers[i] != null, "Pool too small"); }
            check(r.acquireFrame() == null, "Pool grew");
            expectIllegal(new Checked() { public void run() { r.releaseFrame(new byte[3072]); }});
            long start = System.nanoTime(); for (byte[] bytes : buffers) r.submitFrame(bytes, start);
            check(System.nanoTime() - start < TimeUnit.MILLISECONDS.toNanos(250), "Render submission blocked");
            expectIllegal(new Checked() { public void run() { r.releaseFrame(buffers[0]); }});
            Thread.sleep(60); RawFrameRecorder.Snapshot s = r.stop(5000);
            check(s.finalized && s.dropped >= 1 && s.maxQueueDepth <= 4 && s.queueDepth == 0, "Queue limits: " + s.toMap());
            check(r.sampleDue(System.nanoTime()) == false, "Sampling continued after stop");
        }});
        test("empty recordings fail without publishing files", new Checked() { public void run() throws Exception {
            Path output = directory.resolve("empty.mp4"); RawFrameRecorder r = RawFrameRecorder.start(output, 32, 24, 30);
            RawFrameRecorder.Snapshot s = r.stop(1000);
            check(s.state == RawFrameRecorder.State.FAILED && s.error.contains("No frame") && !Files.exists(output), "Empty recording published");
        }});
        test("existing targets and publication races cannot overwrite", new Checked() { public void run() throws Exception {
            Path output = directory.resolve("existing.mp4"); byte[] sentinel = new byte[] {1,2,3,4}; Files.write(output, sentinel);
            try { RawFrameRecorder.start(output, 32, 24, 30); throw new AssertionError("Overwrote existing file"); }
            catch (java.nio.file.FileAlreadyExistsException expected) { }
            Path raced = directory.resolve("raced.mp4"); RawFrameRecorder r = RawFrameRecorder.start(raced, 32, 24, 30);
            capture(r, 12, 34, 56); Thread.sleep(60); Files.write(raced, sentinel);
            check(r.stop(5000).state == RawFrameRecorder.State.FAILED, "Race should fail publication");
            check(Arrays.equals(sentinel, Files.readAllBytes(raced)), "Racing external file overwritten");
            check(Arrays.equals(sentinel, Files.readAllBytes(output)), "Existing external file overwritten");
        }});
        test("exclusive reservation prevents parallel same-name sessions", new Checked() { public void run() throws Exception {
            Path output = directory.resolve("exclusive.mp4"); RawFrameRecorder r = RawFrameRecorder.start(output, 32, 24, 30);
            try { RawFrameRecorder.start(output, 32, 24, 30); throw new AssertionError("Two sessions claimed a name"); }
            catch (java.nio.file.FileAlreadyExistsException expected) { }
            capture(r, 1, 2, 3); check(r.stop(5000).finalized, "Reservation damaged first session");
            check(!Files.exists(output.resolveSibling("exclusive.mp4.mct-recording.lock")), "Reservation leaked");
        }});
        test("first-frame deadline kills a live encoder", new Checked() { public void run() throws Exception {
            System.setProperty("mct.record.ffmpeg", fake("idle", "exec sleep 600").toString());
            RawFrameRecorder r = new RawFrameRecorder(directory.resolve("deadline.mp4"), 32, 24, 30, limits(10000, 150, 1000, 1000));
            awaitTerminal(r, 1500); RawFrameRecorder.Snapshot s = r.stop(1000);
            check(s.error.contains("No frame") && !s.finalized, "First frame deadline absent: " + s.toMap());
        }});
        test("hung stdin is killed independently without a stop request", new Checked() { public void run() throws Exception {
            System.setProperty("mct.record.ffmpeg", directory.resolve("idle.sh").toString());
            RawFrameRecorder r = new RawFrameRecorder(directory.resolve("stalled.mp4"), 128, 128, 30, limits(10000, 1000, 150, 1000));
            capture(r, 1, 2, 3); awaitTerminal(r, 1800); RawFrameRecorder.Snapshot s = r.stop(1000);
            check(s.error.contains("stopped accepting") && s.exitCode != null, "Hung encoder not reaped: " + s.toMap());
        }});
        test("explicit stop has a bounded hung-process timeout", new Checked() { public void run() throws Exception {
            System.setProperty("mct.record.ffmpeg", directory.resolve("idle.sh").toString());
            RawFrameRecorder r = RawFrameRecorder.start(directory.resolve("hung-stop.mp4"), 128, 128, 30);
            capture(r, 1, 2, 3); Thread.sleep(70);
            long before = System.nanoTime(); RawFrameRecorder.Snapshot s = r.stop(100);
            check(System.nanoTime()-before < TimeUnit.MILLISECONDS.toNanos(1000), "Hung stop exceeded bound");
            check(s.state == RawFrameRecorder.State.FAILED && s.error.contains("100 ms") && s.exitCode != null, "Hung stop result: " + s.toMap());
        }});
        test("early exit and stderr are surfaced and bounded", new Checked() { public void run() throws Exception {
            Path stub = fake("noise", "i=0; while [ $i -lt 1000 ]; do echo abcdefghijklmnopqrstuvwxyz0123456789 >&2; i=$((i+1)); done; exit 17");
            System.setProperty("mct.record.ffmpeg", stub.toString());
            RawFrameRecorder r = RawFrameRecorder.start(directory.resolve("early.mp4"), 32, 24, 30);
            awaitTerminal(r, 2000); RawFrameRecorder.Snapshot s = r.stop(1000);
            check(s.exitCode != null && s.exitCode == 17 && s.stderrTail.length() <= 8192 && s.stderrTail.length() > 100, "Diagnostic bounds: " + s.toMap());
        }});
        test("duration limit finalizes exact CFR length", new Checked() { public void run() throws Exception {
            RawFrameRecorder r = new RawFrameRecorder(directory.resolve("duration.mp4"), 32, 24, 20, limits(300, 1000, 1000, 3000));
            capture(r, 100, 100, 100); awaitTerminal(r, 4000); RawFrameRecorder.Snapshot s = r.stop(1000);
            check(s.finalized && s.encoded == 6 && s.elapsedSeconds == .3 && "maximum_duration".equals(s.stopReason), "Duration limit drift: " + s.toMap());
        }});
        test("finalization hang is independently bounded after EOF", new Checked() { public void run() throws Exception {
            System.setProperty("mct.record.ffmpeg", fake("eof-hang", "cat >/dev/null; exec sleep 600").toString());
            RawFrameRecorder r = new RawFrameRecorder(directory.resolve("eof-hang.mp4"), 32, 24, 30, limits(10000, 1000, 1000, 200));
            capture(r, 10, 20, 30); Thread.sleep(50); r.requestStop("test_finalization");
            awaitTerminal(r, 1500); RawFrameRecorder.Snapshot result = r.stop(1000);
            check(!result.finalized && result.exitCode != null && (result.error.contains("finalization") || result.error.contains("did not exit")), "EOF hang: " + result.toMap());
        }});
        test("native default1080p30 encodes real full-resolution frames", new Checked() { public void run() throws Exception {
            RawFrameRecorder r = RawFrameRecorder.start(directory.resolve("native1080.mp4"));
            byte[] bytes = r.acquireFrame(); check(bytes != null && bytes.length == 1920 * 1080 * 4, "Default dimensions");
            for (int y = 0; y < 1080; y++) for (int x = 0; x < 1920; x++) {
                int i = (y * 1920 + x) * 4;
                bytes[i] = (byte) (y < 540 ? 220 : 10); bytes[i + 1] = 30;
                bytes[i + 2] = (byte) (y < 540 ? 10 : 220); bytes[i + 3] = (byte) 255;
            }
            r.submitFrame(bytes, System.nanoTime()); Thread.sleep(350);
            RawFrameRecorder.Snapshot result = r.stop(5000);
            check(result.finalized && result.width == 1920 && result.height == 1080 && result.fps == 30, "1080p result: " + result.toMap());
        }});
        test("concurrent producers, sampling and stop preserve bounded ownership", new Checked() { public void run() throws Exception {
            final RawFrameRecorder r = RawFrameRecorder.start(directory.resolve("concurrent.mp4"), 32, 24, 60);
            final java.util.concurrent.atomic.AtomicReference<Throwable> failure = new java.util.concurrent.atomic.AtomicReference<Throwable>();
            Thread[] workers = new Thread[4];
            for (int n = 0; n < workers.length; n++) workers[n] = new Thread(new Runnable() { public void run() {
                try {
                    long end = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(100);
                    while (System.nanoTime() < end && r.isAcceptingFrames()) {
                        byte[] frame = r.acquireFrame();
                        if (frame != null) { paint(frame, 10, 20, 30); r.submitFrame(frame, System.nanoTime()); }
                    }
                } catch (Throwable e) { failure.compareAndSet(null, e); }
            }});
            for (Thread t : workers) t.start();
            Thread.sleep(50); RawFrameRecorder.Snapshot result = r.stop(5000);
            for (Thread t : workers) t.join(1000);
            check(failure.get() == null && result.finalized, "Concurrent ownership: " + failure.get() + " " + result.toMap());
            check(r.snapshot().queueDepth == 0 && result.maxQueueDepth <= 4, "Late queue leaked");
        }});
        test("disk guard rejects before allocation/process creation", new Checked() { public void run() throws Exception {
            Path output = directory.resolve("disk.mp4");
            RawFrameRecorder.Limits l = new RawFrameRecorder.Limits(1000000000L, 1000, 1000, 1000, Long.MAX_VALUE, 1000000);
            try { new RawFrameRecorder(output, 32, 24, 30, l); throw new AssertionError("Disk guard missing"); }
            catch (IOException expected) { }
            check(!Files.exists(output.resolveSibling("disk.mp4.mct-recording.lock")), "Disk rejection left reservation");
        }});
        test("controller sampling, status, stop/list and capture ownership", new Checked() { public void run() throws Exception {
            final RecordingController c = new RecordingController(); c.updateSource(directory.resolve("controller"), 32, 24, 144);
            Map<String,Object> start = c.handle("recording.start", small("first"));
            check("recording".equals(start.get("state")) && Boolean.FALSE.equals(start.get("finalized")), "Start result");
            expectCode("RECORDING_ALREADY_ACTIVE", new Checked() { public void run() { c.handle("recording.start", small("second")); }});
            long now = System.nanoTime(); RecordingController.Capture capture = c.acquireFrame(now);
            check(capture != null && capture.width == 32 && capture.height == 24 && c.acquireFrame(now) == null, "Sampling burst");
            paint(capture.bytes, 99, 10, 10); c.submitFrame(capture, now);
            expectIllegal(new Checked() { public void run() { c.releaseFrame(capture); }});
            Thread.sleep(70); Map<String,Object> stopped = c.handle("recording.stop", null);
            check("stopped".equals(stopped.get("state")) && Boolean.TRUE.equals(stopped.get("finalized")), "Stop result " + stopped);
            check(Integer.valueOf(144).equals(stopped.get("rendererFps")), "Renderer FPS lost");
            List<?> items = (List<?>) c.handle("recording.list", null).get("recordings");
            check(items.size() == 1 && "first".equals(((Map<?,?>)items.get(0)).get("name")), "List result " + items);
            check(c.handle("recording.stop", null).get("state").equals("stopped"), "Repeated controller stop");
        }});
        test("list excludes in-progress publication and crash-left reserved files", new Checked() { public void run() throws Exception {
            RecordingController c = new RecordingController(); Path game = directory.resolve("listing"); c.updateSource(game, 32, 24);
            Path recordings = game.resolve("recordings"); Files.createDirectories(recordings);
            Files.write(recordings.resolve("copying.mp4"), new byte[] {1, 2, 3});
            Files.createFile(recordings.resolve("copying.mp4.mct-recording.lock"));
            Files.createFile(recordings.resolve("zero.mp4"));
            Files.write(recordings.resolve(".movie.partial.mp4"), new byte[] {1, 2, 3});
            check(((List<?>) c.handle("recording.list", null).get("recordings")).isEmpty(), "Incomplete files listed finalized");
        }});
        test("stale GPU callbacks cannot corrupt a replacement session", new Checked() { public void run() throws Exception {
            RecordingController c = new RecordingController(); c.updateSource(directory.resolve("stale"), 32, 24);
            c.handle("recording.start", small("old")); RecordingController.Capture old = c.acquireFrame(System.nanoTime());
            check(old != null, "No old capture"); c.handle("recording.stop", null);
            c.handle("recording.start", small("new")); RecordingController.Capture fresh = c.acquireFrame(System.nanoTime());
            check(fresh != null && old.sessionId != fresh.sessionId && !c.isAccepting(old), "Session identity");
            c.signalFailure(old, "late GPU failure"); c.releaseFrame(old);
            paint(fresh.bytes, 20, 120, 30); c.submitFrame(fresh, System.nanoTime());
            check(c.isRecording(), "Old callback failed new session");
            check(Boolean.TRUE.equals(c.handle("recording.stop", null).get("finalized")), "Replacement not finalized");
        }});
        test("resize fails promptly and lifecycle stop is nonblocking", new Checked() { public void run() throws Exception {
            RecordingController c = new RecordingController(); c.updateSource(directory.resolve("resize"), 32, 24);
            c.handle("recording.start", small("resize")); RecordingController.Capture frame = c.acquireFrame(System.nanoTime());
            paint(frame.bytes, 1, 2, 3); c.submitFrame(frame, System.nanoTime());
            c.updateSource(directory.resolve("resize"), 64, 48);
            check("failed".equals(c.status().get("state")), "Resize not detected"); c.handle("recording.stop", null);
            c.updateSource(directory.resolve("cancel"), 32, 24); c.handle("recording.start", small("cancel"));
            frame = c.acquireFrame(System.nanoTime()); paint(frame.bytes, 3, 2, 1); c.submitFrame(frame, System.nanoTime());
            long before = System.nanoTime(); c.cancel("client_shutdown");
            check(System.nanoTime()-before < TimeUnit.MILLISECONDS.toNanos(200), "Lifecycle cancellation blocked");
            check(Boolean.TRUE.equals(c.handle("recording.stop", null).get("finalized")), "Lifecycle finalization failed");
        }});
        test("interrupted start leaves no recording and status does not cancel active session", new Checked() { public void run() throws Exception {
            final RecordingController c = new RecordingController(); c.updateSource(directory.resolve("interrupt"), 32, 24);
            Thread.currentThread().interrupt();
            try { expectCode("RECORDING_START_FAILED", new Checked() { public void run() { c.handle("recording.start", small("interrupted")); }}); }
            finally { Thread.interrupted(); }
            check(!c.isRecording(), "Canceled start orphaned recording");
            c.handle("recording.start", small("active"));
            Thread.currentThread().interrupt();
            try { c.handle("recording.status", null); c.handle("recording.list", null); }
            finally { Thread.interrupted(); }
            check(c.isRecording(), "Status/list cancellation killed recording");
            RecordingController.Capture capture = c.acquireFrame(System.nanoTime()); paint(capture.bytes, 4, 5, 6); c.submitFrame(capture, System.nanoTime());
            c.handle("recording.stop", null);
        }});
        test("cancellation during startup cannot publish an orphan session", new Checked() { public void run() throws Exception {
            final java.util.concurrent.CountDownLatch entered = new java.util.concurrent.CountDownLatch(1);
            final java.util.concurrent.CountDownLatch proceed = new java.util.concurrent.CountDownLatch(1);
            final java.util.concurrent.atomic.AtomicReference<Throwable> result = new java.util.concurrent.atomic.AtomicReference<Throwable>();
            final RecordingController c = new RecordingController(new RecordingController.RecorderFactory() {
                public RawFrameRecorder create(Path path, int width, int height, int fps, int duration) throws IOException {
                    entered.countDown();
                    try { if (!proceed.await(2, TimeUnit.SECONDS)) throw new IOException("Test latch timed out"); }
                    catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IOException(e); }
                    return RawFrameRecorder.start(path, width, height, fps, duration);
                }
            });
            c.updateSource(directory.resolve("startup-cancel"), 32, 24);
            Thread request = new Thread(new Runnable() { public void run() {
                try { c.handle("recording.start", small("canceled")); result.set(new AssertionError("Canceled startup succeeded")); }
                catch (Throwable expected) { result.set(expected); }
            }});
            request.start(); check(entered.await(2, TimeUnit.SECONDS), "Startup did not reach factory");
            c.cancel("client_shutdown"); proceed.countDown(); request.join(3000);
            check(!request.isAlive() && result.get() instanceof RecordingController.RecordingException, "Startup cancellation result: " + result.get());
            check(!c.isRecording() && "idle".equals(c.status().get("state")), "Canceled startup retained session");
        }});
        test("automatic terminal sessions release their pooled-image owner", new Checked() { public void run() throws Exception {
            final RecordingController c = new RecordingController(new RecordingController.RecorderFactory() {
                public RawFrameRecorder create(Path path, int width, int height, int fps, int duration) throws IOException {
                    return new RawFrameRecorder(path, width, height, fps, limits(150, 1000, 1000, 3000));
                }
            });
            c.updateSource(directory.resolve("auto-release"), 32, 24); c.handle("recording.start", small("auto"));
            RecordingController.Capture frame = c.acquireFrame(System.nanoTime()); paint(frame.bytes, 7, 8, 9); c.submitFrame(frame, System.nanoTime());
            java.lang.reflect.Field owner = RecordingController.class.getDeclaredField("recorder"); owner.setAccessible(true);
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
            while (owner.get(c) != null && System.nanoTime() < deadline) Thread.sleep(5);
            check(owner.get(c) == null && Boolean.TRUE.equals(c.status().get("finalized")), "Terminal recorder retained image pool");
        }});
        test("worker creation/start failures roll back child and reservation", new Checked() { public void run() throws Exception {
            for (final boolean failOnStart : new boolean[] {false, true}) {
                Path output = directory.resolve("worker-failure-" + failOnStart + ".mp4");
                RawFrameRecorder.WorkerFactory workers = new RawFrameRecorder.WorkerFactory() {
                    public Thread create(String name, Runnable runnable) {
                        if (!failOnStart) throw new SecurityException("Test worker creation denied");
                        return new Thread(runnable, name) {
                            @Override public synchronized void start() { throw new SecurityException("Test worker start denied"); }
                        };
                    }
                };
                try { new RawFrameRecorder(output, 32, 24, 30, limits(1000, 1000, 1000, 1000), workers); throw new AssertionError("Worker failure ignored"); }
                catch (IOException expected) { check(expected.getMessage().contains("workers"), "Worker error lost"); }
                check(!Files.exists(output) && !Files.exists(output.resolveSibling(output.getFileName() + ".mct-recording.lock")), "Worker failure leaked reservation");
            }
        }});
        System.clearProperty("mct.record.ffmpeg");
        System.out.println("PASS ALL " + passed + " RECORDING CORE TESTS");
    }
}
