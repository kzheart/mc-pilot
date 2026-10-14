package com.mct.core.recording;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Synthetic fixtures verify capture/mux plumbing, not real-game audio provenance. */
public final class AudioCaptureTest {
    private static final AudioCapture.Provider SOURCE = new AudioCapture.Provider() {
        public String name() { return "unit-test-pcm-fixture"; }
        public String unavailableReason() { return null; }
    };
    private static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
    private static long count(Map<String, Object> m, String key) { return ((Number) m.get(key)).longValue(); }
    private static byte[] fixture(int frames) {
        byte[] bytes = new byte[frames * 4];
        for (int i = 0; i < frames; i++) {
            short left = (short) ((i / 48 % 2 == 0) ? 6000 : -6000), right = (short) -left;
            bytes[i*4] = (byte) left; bytes[i*4+1] = (byte) (left >> 8);
            bytes[i*4+2] = (byte) right; bytes[i*4+3] = (byte) (right >> 8);
        }
        return bytes;
    }
    private static void paint(byte[] bytes, int red, int blue) {
        for (int i = 0; i < bytes.length; i += 4) {
            bytes[i] = (byte) red; bytes[i+1] = 10; bytes[i+2] = (byte) blue; bytes[i+3] = (byte) 255;
        }
    }
    private static void capture(RawFrameRecorder r) {
        byte[] bytes = r.acquireFrame(); check(bytes != null, "No frame buffer"); paint(bytes, 220, 10);
        check(r.submitFrame(bytes, System.nanoTime()), "Video submit failed");
    }
    private static RawFrameRecorder start(Path directory, String name) throws IOException {
        return RawFrameRecorder.start(directory.resolve(name + ".mp4"), 32, 24, 30);
    }
    private static void waitUntil(long nanos) throws InterruptedException {
        while (System.nanoTime() < nanos) Thread.sleep(1);
    }
    public static void main(String[] argv) throws Exception {
        Path directory = Paths.get(argv[0]); Files.createDirectories(directory);
        System.setProperty("mct.record.audio", "true");
        try {
            try { start(directory, "audio-unavailable"); throw new AssertionError("Missing provider accepted"); }
            catch (IOException expected) { check(expected.getMessage().contains("audio is unavailable"), expected.toString()); }
            check(!Files.exists(directory.resolve("audio-unavailable.mp4.mct-recording.lock")), "Unavailable source reserved output");
            AudioCapture.register(SOURCE); System.clearProperty("mct.record.audio");
            RawFrameRecorder silent = start(directory, "audio-disabled"); capture(silent);
            check(!AudioCapture.submit(SOURCE, fixture(480), 0, 480, System.nanoTime()), "Disabled audio accepted");
            RawFrameRecorder.Snapshot silentResult = silent.stop(5000);
            check(!silentResult.audio && silentResult.videoHoldbackMillis == 0, "Silent default changed");
            System.setProperty("mct.record.audio", "true");
            System.out.println("PASS opt-in audio and explicit unavailable-provider failure");

            RawFrameRecorder timed = start(directory, "audio-aligned"); capture(timed); Thread.sleep(120);
            byte[] pcm = fixture(4800);
            check(AudioCapture.submit(SOURCE, pcm, 0, 4800, timed.getStartNanos() + TimeUnit.MILLISECONDS.toNanos(100)), "First PCM rejected");
            Arrays.fill(pcm, (byte) 0); Thread.sleep(120);
            check(AudioCapture.submit(SOURCE, fixture(4800), 0, 4800, timed.getStartNanos() + TimeUnit.MILLISECONDS.toNanos(220)), "Second PCM rejected");
            Thread.sleep(160); RawFrameRecorder.Snapshot aligned = timed.stop(5000);
            check(aligned.finalized && aligned.audio, "Audio mux failed: " + aligned.toMap());
            Map<String, Object> a = aligned.audioCapture;
            check(count(a, "sampleFrames") == 9600 && count(a, "nonzeroSampleFrames") == 9600, "PCM counts: " + a);
            check(count(a, "outputSampleFrames") == aligned.encoded * 1600, "PCM duration: " + a);
            check(count(a, "paddedSampleFrames") >= 5760 && count(a, "droppedSampleFrames") == 0, "Gaps: " + a);
            check(Double.valueOf(.1).equals(a.get("firstSampleOffsetSeconds")), "First offset: " + a);
            Files.write(directory.resolve("audio-expected.txt"), (aligned.encoded + "\n" + count(a, "outputSampleFrames") + "\n").getBytes(StandardCharsets.UTF_8));
            System.out.println("PASS common-clock padding, copied buffers and AAC mux: " + a);

            RawFrameRecorder early = start(directory, "audio-trimmed"); capture(early);
            check(AudioCapture.submit(SOURCE, fixture(4800), 0, 4800, early.getStartNanos() - TimeUnit.MILLISECONDS.toNanos(50)), "Pre-roll rejected");
            Thread.sleep(100); RawFrameRecorder.Snapshot trimmed = early.stop(5000);
            check(trimmed.finalized && count(trimmed.audioCapture, "trimmedSampleFrames") == 2400, "Pre-start trim: " + trimmed.toMap());
            check(PcmCapture.framesForNanos(-1) == -1 && PcmCapture.framesForNanos(1000000000L) == 48000, "Signed clock rounding");
            System.out.println("PASS PCM block straddling start trims pre-roll");

            RawFrameRecorder delayed = start(directory, "audio-delayed-frame");
            byte[] initial = delayed.acquireFrame(); paint(initial, 220, 10); delayed.submitFrame(initial, delayed.getStartNanos());
            AudioCapture.submit(SOURCE, fixture(480), 0, 480, delayed.getStartNanos());
            byte[] late = delayed.acquireFrame(); paint(late, 10, 220);
            waitUntil(delayed.getStartNanos() + TimeUnit.MILLISECONDS.toNanos(195));
            check(delayed.submitFrame(late, delayed.getStartNanos() + TimeUnit.MILLISECONDS.toNanos(100)), "Delayed callback rejected");
            waitUntil(delayed.getStartNanos() + TimeUnit.MILLISECONDS.toNanos(310));
            RawFrameRecorder.Snapshot delayedResult = delayed.stop(5000);
            check(delayedResult.finalized && delayedResult.videoHoldbackMillis == 100, "Holdback: " + delayedResult.toMap());
            check(delayedResult.encoded == (long) Math.ceil(delayedResult.elapsedSeconds * 30), "Holdback changed duration");
            RawFrameRecorder stop = start(directory, "audio-pending-stop"); capture(stop);
            AudioCapture.submit(SOURCE, fixture(480), 0, 480, stop.getStartNanos()); Thread.sleep(75);
            long capturedAt = System.nanoTime(); byte[] pending = stop.acquireFrame(); paint(pending, 10, 220);
            stop.requestStop("test_pending_drain");
            check(stop.acquireFrame() == null && stop.isAcceptingPendingFrames(), "Stop permitted new capture or lost pending capture");
            Thread.sleep(35); check(stop.submitFrame(pending, capturedAt), "Pre-stop callback rejected");
            check(stop.stop(5000).finalized, "Pending stop failed");
            System.out.println("PASS audio-only video holdback and pre-stop callback drain");

            RawFrameRecorder empty = start(directory, "audio-empty"); capture(empty); RawFrameRecorder.Snapshot emptyResult = empty.stop(5000);
            check(!emptyResult.finalized && emptyResult.error.contains("no PCM") && !Files.exists(emptyResult.outputPath), "Missing PCM published");
            RawFrameRecorder malformed = start(directory, "audio-malformed"); capture(malformed);
            check(!AudioCapture.submit(SOURCE, new byte[4], 0, AudioCapture.MAX_BLOCK_FRAMES + 1, System.nanoTime()), "Oversized PCM accepted");
            check(!malformed.stop(1000).finalized && !Files.exists(malformed.snapshot().outputPath), "Malformed PCM published");
            RawFrameRecorder lost = start(directory, "audio-lost-provider"); capture(lost); AudioCapture.unregister(SOURCE, "Test mixer stopped");
            check(!lost.stop(1000).finalized && lost.snapshot().error.contains("mixer stopped"), "Source loss hidden");
            AudioCapture.register(SOURCE);
            System.out.println("PASS missing, malformed and lost audio never silently degrade");

            final CountDownLatch gate = new CountDownLatch(1);
            RawFrameRecorder.WorkerFactory workers = new RawFrameRecorder.WorkerFactory() {
                public Thread create(String name, final Runnable runnable) {
                    final boolean pcmWriter = name.contains("pcm-writer");
                    Thread thread = new Thread(new Runnable() {
                        public void run() {
                            if (pcmWriter) try { gate.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                            runnable.run();
                        }
                    }, name);
                    thread.setDaemon(true); return thread;
                }
            };
            RawFrameRecorder pressure = new RawFrameRecorder(directory.resolve("audio-pressure.mp4"), 32, 24, 30,
                    new RawFrameRecorder.Limits(10), workers); capture(pressure); byte[] block = fixture(480);
            for (int i = 0; i < AudioCapture.QUEUE_CAPACITY; i++)
                check(AudioCapture.submit(SOURCE, block, 0, 480, pressure.getStartNanos()), "Queue filled early");
            check(!AudioCapture.submit(SOURCE, block, 0, 480, pressure.getStartNanos()), "PCM queue grew");
            check(count(pressure.snapshot().audioCapture, "droppedSampleFrames") == 480, "Drops not counted");
            gate.countDown(); Thread.sleep(60);
            check(pressure.stop(5000).finalized && count(pressure.snapshot().audioCapture, "maxQueueDepth") == 32, "Bounded writer failed");
            System.out.println("PASS 32-block bounded PCM queue pressure");

            RawFrameRecorder raced = start(directory, "audio-raced"); capture(raced);
            AudioCapture.submit(SOURCE, fixture(480), 0, 480, raced.getStartNanos());
            byte[] sentinel = new byte[] {4, 3, 2, 1}; Files.write(raced.snapshot().outputPath, sentinel);
            check(!raced.stop(5000).finalized && Arrays.equals(sentinel, Files.readAllBytes(raced.snapshot().outputPath)), "Mux overwrote racing output");
            System.out.println("PASS audio mux no-overwrite publication");

            String realFfmpeg = RawFrameRecorder.ffmpegExecutable().toString();
            for (boolean hang : new boolean[] {false, true}) {
                Path encoder = directory.resolve("audio-mux-" + hang + ".sh");
                String script = "#!/bin/sh\nfor arg in \"$@\"; do\n if [ \"$arg\" = s16le ]; then " +
                        (hang ? "exec sleep 600" : "echo test-audio-mux-failed >&2; exit 19") +
                        "; fi\ndone\nexec '" + realFfmpeg.replace("'", "'\\''") + "' \"$@\"\n";
                Files.write(encoder, script.getBytes(StandardCharsets.UTF_8)); check(encoder.toFile().setExecutable(true), "Cannot make test encoder executable");
                System.setProperty("mct.record.ffmpeg", encoder.toAbsolutePath().toString());
                RawFrameRecorder mux = new RawFrameRecorder(directory.resolve("audio-mux-" + hang + ".mp4"), 32, 24, 30,
                        new RawFrameRecorder.Limits(TimeUnit.SECONDS.toNanos(10), 5000, 5000, 1200, 0, RawFrameRecorder.MAX_OUTPUT_BYTES));
                capture(mux); AudioCapture.submit(SOURCE, fixture(480), 0, 480, mux.getStartNanos());
                long before = System.nanoTime(); RawFrameRecorder.Snapshot result = mux.stop(2500);
                check(!result.finalized && !Files.exists(result.outputPath), "Failed mux published");
                check(System.nanoTime() - before < TimeUnit.SECONDS.toNanos(3), "Mux timeout unbounded");
                if (!hang) check(Integer.valueOf(19).equals(result.audioMuxExitCode) && result.error.contains("Audio mux"), "Mux diagnostics lost");
            }
            System.out.println("PASS failed and hung AAC muxes fail within shared deadline");
        } finally {
            AudioCapture.unregister(SOURCE, "Test finished"); System.clearProperty("mct.record.audio"); System.clearProperty("mct.record.ffmpeg");
        }
        System.out.println("PASS ALL AUDIO CAPTURE TESTS (synthetic test fixtures are not game audio evidence)");
    }
}
