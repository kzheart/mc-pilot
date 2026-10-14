package com.mct.core.recording;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.locks.LockSupport;

/**
 * Java 8, Minecraft-independent, bounded RGBA -> H.264/MP4 encoder.
 *
 * <p>Only start/stop do blocking work. The render thread borrows preallocated,
 * top-down tightly packed RGBA arrays with acquireFrame(), submits ownership with
 * submitFrame(), or returns unused arrays with releaseFrame(). These operations
 * never wait for the encoder or acquire a monitor. Do not touch an array after
 * submitting it, even when submit returns false. The pool is fixed at six images.
 * CFR timestamps derive from a monotonic clock; gaps duplicate the last image.
 * The first captured image fills any initial delay (there are no black frames).
 * A watchdog kills a blocked encoder independently of the pipe-writing thread.
 * Only STOPPED/finalized means that an MP4 is complete and published.</p>
 */
public final class RawFrameRecorder {
    public static final int DEFAULT_WIDTH = 1920, DEFAULT_HEIGHT = 1080, DEFAULT_FPS = 30;
    public static final int QUEUE_CAPACITY = 4, POOL_SIZE = QUEUE_CAPACITY + 2;
    public static final int MAX_WIDTH = 7680, MAX_HEIGHT = 4320, MAX_FPS = 120;
    public static final long MAX_MEMORY_BYTES = 256L * 1024 * 1024;
    public static final long MAX_OUTPUT_BYTES = 2L * 1024 * 1024 * 1024;
    public static final int DEFAULT_DURATION_SECONDS = 1800, MAX_DURATION_SECONDS = 7200;
    public static final long MIN_FREE_BYTES = 64L * 1024 * 1024;
    public static final long FIRST_FRAME_TIMEOUT_MILLIS = 15000, STOP_TIMEOUT_MILLIS = 20000;
    private static final AtomicLong SESSION_IDS = new AtomicLong();
    private final long sessionId = SESSION_IDS.incrementAndGet();
    private static final int FREE = 0, BORROWED = 1, QUEUED = 2, ENCODER = 3;
    private static final long STALL_TIMEOUT_MILLIS = 10000;

    public enum State { STARTING, RECORDING, STOPPING, STOPPED, FAILED }

    /** Immutable, independently sampled monotonic counters. */
    public static final class Snapshot {
        public final State state;
        public final int width, height, fps, queueDepth, maxQueueDepth, queueCapacity, poolSize;
        public final long captured, encoded, duplicate, dropped;
        public final Path outputPath, partialPath;
        public final double elapsedSeconds, firstFrameWaitSeconds, capturedFps, videoHoldbackMillis;
        public final String error, stderrTail, stopReason;
        public final Integer exitCode, audioMuxExitCode;
        public final boolean finalized;
        public final boolean audio;
        public final Map<String, Object> audioCapture;
        private Snapshot(RawFrameRecorder r) {
            state = r.state.get(); width = r.width; height = r.height; fps = r.fps;
            queueDepth = r.queueDepth.get(); maxQueueDepth = r.maxQueueDepth.get();
            queueCapacity = QUEUE_CAPACITY; poolSize = POOL_SIZE;
            captured = r.captured.get(); encoded = r.encoded.get();
            duplicate = r.duplicate.get(); dropped = r.dropped.get();
            outputPath = r.outputPath; partialPath = r.partialPath;
            long end = r.stopNanos.get();
            elapsedSeconds = Math.max(0, (end == 0 ? System.nanoTime() : end) - r.startNanos) / 1e9;
            long first = r.firstFrameNanos.get();
            firstFrameWaitSeconds = first == 0 ? -1 : Math.max(0, first - r.startNanos) / 1e9;
            capturedFps = elapsedSeconds > 0 ? captured / elapsedSeconds : 0;
            videoHoldbackMillis = r.videoHoldbackNanos() / 1e6;
            error = r.error.get(); stderrTail = r.logTail(); exitCode = r.exitCode; audioMuxExitCode = r.muxExitCode;
            stopReason = r.stopReason.get(); finalized = state == State.STOPPED;
            audio = r.audioCapture != null && finalized;
            audioCapture = r.audioCapture == null ? silentAudio() : r.audioCapture.snapshot(finalized);
        }
        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<String, Object>();
            m.put("state", state.name().toLowerCase(Locale.ROOT)); m.put("finalized", finalized);
            m.put("width", width); m.put("height", height); m.put("fps", fps);
            m.put("captured", captured); m.put("encoded", encoded); m.put("duplicate", duplicate);
            m.put("dropped", dropped); m.put("queueDepth", queueDepth); m.put("maxQueueDepth", maxQueueDepth);
            m.put("queueCapacity", queueCapacity); m.put("poolSize", poolSize);
            m.put("outputPath", outputPath.toString());
            m.put("partialPath", finalized ? null : partialPath.toString());
            m.put("elapsedSeconds", elapsedSeconds); m.put("firstFrameWaitSeconds", firstFrameWaitSeconds);
            m.put("capturedFps", capturedFps); m.put("error", error); m.put("stderrTail", stderrTail);
            m.put("exitCode", exitCode); m.put("stopReason", stopReason);
            m.put("audio", audio); m.put("audioCapture", audioCapture); m.put("audioMuxExitCode", audioMuxExitCode);
            m.put("videoHoldbackMillis", videoHoldbackMillis);
            return m;
        }
    }

    /* Package-private knobs shorten deterministic watchdog tests; not protocol parameters. */
    static final class Limits {
        final long durationNanos, firstFrameMillis, stallMillis, finalizationMillis, minFreeBytes, maxOutputBytes;
        Limits(int seconds) { this(TimeUnit.SECONDS.toNanos(seconds), FIRST_FRAME_TIMEOUT_MILLIS,
                STALL_TIMEOUT_MILLIS, STOP_TIMEOUT_MILLIS, MIN_FREE_BYTES, MAX_OUTPUT_BYTES); }
        Limits(long durationNanos, long firstFrameMillis, long stallMillis, long finalizationMillis,
               long minFreeBytes, long maxOutputBytes) {
            this.durationNanos = durationNanos; this.firstFrameMillis = firstFrameMillis;
            this.stallMillis = stallMillis; this.finalizationMillis = finalizationMillis;
            this.minFreeBytes = minFreeBytes; this.maxOutputBytes = maxOutputBytes;
        }
    }
    private static final class Buffer {
        final byte[] bytes;
        final AtomicInteger owner = new AtomicInteger(FREE);
        Buffer(int size) { bytes = new byte[size]; }
    }
    private static final class Frame {
        final Buffer buffer;
        final long slot;
        boolean used;
        Frame(Buffer buffer, long slot) { this.buffer = buffer; this.slot = slot; }
    }

    private final int width, height, fps, frameBytes;
    private final Path outputPath, partialPath, reservationPath;
    private final Limits limits;
    private final ConcurrentLinkedQueue<Buffer> pool = new ConcurrentLinkedQueue<Buffer>();
    private final ConcurrentLinkedQueue<Frame> frames = new ConcurrentLinkedQueue<Frame>();
    // Fully populated before publication; byte[] equality is identity equality.
    private final Map<byte[], Buffer> buffers = new HashMap<byte[], Buffer>();
    private final AtomicReference<State> state = new AtomicReference<State>(State.STARTING);
    private final AtomicReference<String> error = new AtomicReference<String>();
    private final AtomicReference<String> stopReason = new AtomicReference<String>();
    private final AtomicLong captured = new AtomicLong(), encoded = new AtomicLong();
    private final AtomicLong duplicate = new AtomicLong(), dropped = new AtomicLong();
    private final AtomicLong stopNanos = new AtomicLong(), firstFrameNanos = new AtomicLong();
    private final AtomicLong latestSubmittedSlot = new AtomicLong(-1), sampledSlot = new AtomicLong(-1);
    private final AtomicLong writeStartedNanos = new AtomicLong();
    private final AtomicInteger queueDepth = new AtomicInteger(), maxQueueDepth = new AtomicInteger();
    private final CountDownLatch finished = new CountDownLatch(1);
    private final StringBuilder diagnostics = new StringBuilder();
    private final Process process;
    private final long startNanos;
    private final Path executable;
    private volatile PcmCapture audioCapture;
    private volatile Process muxProcess;
    private volatile Path muxPath;
    private volatile Integer muxExitCode;
    private volatile boolean videoInputClosed;
    private Thread encoderThread, stderrThread, watchdogThread, shutdownHook;
    private final AtomicReference<Runnable> completionListener = new AtomicReference<Runnable>();
    private volatile boolean publishedOutput;
    private volatile Integer exitCode;

    public static RawFrameRecorder start(Path output) throws IOException {
        return start(output, DEFAULT_WIDTH, DEFAULT_HEIGHT, DEFAULT_FPS);
    }
    public static RawFrameRecorder start(Path output, int width, int height, int fps) throws IOException {
        return start(output, width, height, fps, DEFAULT_DURATION_SECONDS);
    }
    public static RawFrameRecorder start(Path output, int width, int height, int fps, int maxDurationSeconds)
            throws IOException {
        if (maxDurationSeconds < 1 || maxDurationSeconds > MAX_DURATION_SECONDS)
            throw new IllegalArgumentException("maxDurationSeconds must be from 1 to " + MAX_DURATION_SECONDS);
        return new RawFrameRecorder(output, width, height, fps, new Limits(maxDurationSeconds));
    }
    public static void validateDimensions(int width, int height, int fps) {
        if (width < 2 || height < 2 || (width & 1) != 0 || (height & 1) != 0 ||
                width > MAX_WIDTH || height > MAX_HEIGHT || fps < 1 || fps > MAX_FPS)
            throw new IllegalArgumentException("Even dimensions from 2x2 to 7680x4320 and 1-120 fps are required");
        if ((long) width * height * 4 * POOL_SIZE > MAX_MEMORY_BYTES)
            throw new IllegalArgumentException("The six-frame recording pool must fit within 256 MiB");
    }

    /** Trusted launch configuration only; never accepts a WebSocket executable or a shell command. */
    public static Path ffmpegExecutable() throws IOException {
        String configured = System.getProperty("mct.record.ffmpeg", "ffmpeg");
        if (configured.trim().isEmpty() || configured.indexOf('\0') >= 0)
            throw new IOException("mct.record.ffmpeg must name an executable");
        Path path = Paths.get(configured);
        if (path.isAbsolute()) {
            if (Files.isRegularFile(path) && Files.isExecutable(path)) return path;
            throw new IOException("Configured FFmpeg executable was not found: " + path);
        }
        if (!configured.equals("ffmpeg") && !configured.equals("ffmpeg.exe"))
            throw new IOException("mct.record.ffmpeg must be an absolute executable path");
        String search = System.getenv("PATH");
        boolean windows = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
        if (search != null) for (String directory : search.split(java.io.File.pathSeparator)) {
            if (directory.isEmpty()) continue; // Do not execute a binary from the game working directory implicitly.
            Path candidate = Paths.get(directory).resolve(windows ? "ffmpeg.exe" : configured);
            if (Files.isRegularFile(candidate) && Files.isExecutable(candidate)) return candidate.toAbsolutePath();
        }
        throw new IOException("FFmpeg was not found on PATH; configure -Dmct.record.ffmpeg=/absolute/path/ffmpeg before launching Minecraft");
    }

    interface WorkerFactory { Thread create(String name, Runnable runnable); }
    private static final WorkerFactory DEFAULT_WORKERS = new WorkerFactory() {
        @Override public Thread create(String name, Runnable runnable) { return daemon(name, runnable); }
    };
    RawFrameRecorder(Path output, int width, int height, int fps, Limits limits) throws IOException {
        this(output, width, height, fps, limits, DEFAULT_WORKERS);
    }
    RawFrameRecorder(Path output, int width, int height, int fps, Limits limits, WorkerFactory workerFactory) throws IOException {
        if (output == null) throw new IllegalArgumentException("Output path is required");
        validateDimensions(width, height, fps);
        this.width = width; this.height = height; this.fps = fps; this.limits = limits;
        frameBytes = width * height * 4;
        outputPath = output.toAbsolutePath().normalize();
        if (!outputPath.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".mp4"))
            throw new IllegalArgumentException("Output must end in .mp4");
        executable = ffmpegExecutable();
        AudioCapture.Provider audioProvider = AudioCapture.isRequested() ? AudioCapture.requireProvider() : null;
        Files.createDirectories(outputPath.getParent());
        if (Files.exists(outputPath)) throw new FileAlreadyExistsException(outputPath.toString());
        if (Files.getFileStore(outputPath.getParent()).getUsableSpace() < limits.minFreeBytes)
            throw new IOException("At least 64 MiB of free disk space is required");
        // A CREATE_NEW reservation prevents two cooperating sessions from claiming one name.
        reservationPath = outputPath.resolveSibling(outputPath.getFileName() + ".mct-recording.lock");
        Files.createFile(reservationPath);
        Path temporary = null;
        Process started = null;
        try {
            if (Files.exists(outputPath)) throw new FileAlreadyExistsException(outputPath.toString());
            for (int i = 0; i < POOL_SIZE; i++) {
                Buffer b = new Buffer(frameBytes); buffers.put(b.bytes, b); pool.add(b);
            }
            temporary = Files.createTempFile(outputPath.getParent(), "." + outputPath.getFileName() + ".", ".partial.mp4");
            started = new ProcessBuilder(executable.toString(), "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                    "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", width + "x" + height,
                    "-framerate", Integer.toString(fps), "-i", "pipe:0", "-an", "-c:v", "libx264",
                    "-preset", "veryfast", "-crf", "24", "-threads", "4", "-pix_fmt", "yuv420p",
                    "-fs", Long.toString(limits.maxOutputBytes), "-movflags", "+faststart", "-f", "mp4", temporary.toString())
                    .redirectErrorStream(true).start();
        } catch (Throwable failure) {
            if (started != null) started.destroyForcibly();
            if (temporary != null) try { Files.deleteIfExists(temporary); } catch (IOException ignored) { }
            try { Files.deleteIfExists(reservationPath); } catch (IOException ignored) { }
            if (failure instanceof IOException) throw (IOException) failure;
            if (failure instanceof RuntimeException) throw (RuntimeException) failure;
            if (failure instanceof Error) throw (Error) failure;
            throw new IOException(failure);
        }
        partialPath = temporary; process = started; startNanos = System.nanoTime();
        try {
            if (audioProvider != null)
                audioCapture = new PcmCapture(this, audioProvider, outputPath.getParent(), limits.durationNanos, workerFactory);
            stderrThread = workerFactory.create("mct-recording-ffmpeg-log", new Runnable() {
                @Override public void run() { drainLog(process.getInputStream()); }
            });
            encoderThread = workerFactory.create("mct-recording-encoder", new Runnable() {
                @Override public void run() { encode(); }
            });
            watchdogThread = workerFactory.create("mct-recording-watchdog", new Runnable() {
                @Override public void run() { watch(); }
            });
            shutdownHook = new Thread(new Runnable() {
                @Override public void run() { stop(2000); }
            }, "mct-recording-shutdown");
            // Publish RECORDING before installing a hook that can immediately request stop.
            state.set(State.RECORDING);
            try { Runtime.getRuntime().addShutdownHook(shutdownHook); }
            catch (IllegalStateException shuttingDown) {
                process.destroyForcibly();
                try { Files.deleteIfExists(reservationPath); Files.deleteIfExists(partialPath); } catch (IOException ignored) { }
                throw new IOException("JVM is already shutting down", shuttingDown);
            } catch (SecurityException restricted) { /* Explicit lifecycle cancellation still works. */ }
            if (audioCapture != null) audioCapture.start();
            stderrThread.start(); encoderThread.start(); watchdogThread.start();
        } catch (Throwable startFailure) {
            // Native-thread exhaustion must not orphan the just-started child process.
            fail("Unable to start recording workers: " + startFailure.getClass().getSimpleName());
            killProcess(); if (encoderThread != null) LockSupport.unpark(encoderThread);
            if (audioCapture != null) { audioCapture.abort(); audioCapture.delete(); }
            try { if (shutdownHook != null) Runtime.getRuntime().removeShutdownHook(shutdownHook); }
            catch (IllegalStateException ignored) { } catch (SecurityException ignored) { }
            try { Files.deleteIfExists(reservationPath); } catch (IOException ignored) { }
            try { Files.deleteIfExists(partialPath); } catch (IOException ignored) { }
            if (startFailure instanceof Error) throw (Error) startFailure;
            throw new IOException("Unable to start recording workers", startFailure);
        }
    }
    private static Thread daemon(String name, Runnable runnable) {
        Thread thread = new Thread(runnable, name); thread.setDaemon(true); return thread;
    }
    public boolean isAcceptingFrames() { return state.get() == State.RECORDING; }
    /** Stop rejects new captures but briefly drains already-borrowed audio-session GPU frames. */
    public boolean isAcceptingPendingFrames() {
        State current = state.get();
        if (current == State.RECORDING) return true;
        long end = stopNanos.get();
        return current == State.STOPPING && audioCapture != null && !videoInputClosed && end != 0 &&
                System.nanoTime() - end < videoHoldbackNanos();
    }
    private long videoHoldbackNanos() {
        // Three intervals fit the four-frame queue plus last/pending buffers. PTS does not move.
        return audioCapture == null ? 0 : Math.min(TimeUnit.MILLISECONDS.toNanos(100), 3000000000L / fps);
    }
    public long getSessionId() { return sessionId; }
    public int getFrameBytes() { return frameBytes; }
    public int getWidth() { return width; }
    public int getHeight() { return height; }
    public int getFps() { return fps; }
    public long getStartNanos() { return startNanos; }

    /** Claims at most one sampling opportunity per CFR slot without catch-up bursts. */
    public boolean sampleDue(long nowNanos) {
        if (!isAcceptingFrames()) return false;
        long slot = FrameTimeline.slot(Math.max(0, nowNanos - startNanos), fps);
        long previous;
        do { previous = sampledSlot.get(); if (slot <= previous) return false; }
        while (!sampledSlot.compareAndSet(previous, slot));
        return true;
    }
    public byte[] acquireFrame() {
        if (!isAcceptingFrames()) return null;
        Buffer buffer = pool.poll();
        if (buffer == null) { dropped.incrementAndGet(); return null; }
        if (!buffer.owner.compareAndSet(FREE, BORROWED)) throw new IllegalStateException("Corrupt frame ownership");
        if (!isAcceptingFrames()) { recycle(buffer, BORROWED); return null; }
        return buffer.bytes;
    }
    public void releaseFrame(byte[] bytes) {
        if (!recycle(requireBuffer(bytes), BORROWED)) throw new IllegalArgumentException("Frame is not borrowed");
    }
    /** Always consumes a valid borrowed frame, including on false (pressure/stop/stale capture). */
    public boolean submitFrame(byte[] bytes, long captureNanos) {
        Buffer buffer = requireBuffer(bytes);
        if (!buffer.owner.compareAndSet(BORROWED, QUEUED)) throw new IllegalArgumentException("Frame is not borrowed");
        long end = stopNanos.get();
        if (!isAcceptingPendingFrames() || (end != 0 && captureNanos > end)) { recycle(buffer, QUEUED); return false; }
        captured.incrementAndGet();
        long captureTime = Math.max(startNanos, Math.min(System.nanoTime(), captureNanos));
        long slot = FrameTimeline.slot(captureTime - startNanos, fps);
        long previous;
        do {
            previous = latestSubmittedSlot.get();
            if (slot < previous) { dropped.incrementAndGet(); recycle(buffer, QUEUED); return false; }
        } while (!latestSubmittedSlot.compareAndSet(previous, slot));
        int depth;
        do {
            depth = queueDepth.get();
            if (depth >= QUEUE_CAPACITY) { dropped.incrementAndGet(); recycle(buffer, QUEUED); return false; }
        } while (!queueDepth.compareAndSet(depth, depth + 1));
        Frame frame = new Frame(buffer, slot);
        frames.offer(frame);
        firstFrameNanos.compareAndSet(0, captureTime);
        int max;
        do { max = maxQueueDepth.get(); if (depth + 1 <= max) break; }
        while (!maxQueueDepth.compareAndSet(max, depth + 1));
        // An offer may race the encoder's final drain. The producer reclaims its own late offer.
        if (!isAcceptingPendingFrames() && frames.remove(frame)) {
            queueDepth.decrementAndGet(); dropped.incrementAndGet(); recycle(buffer, QUEUED); return false;
        }
        LockSupport.unpark(encoderThread);
        return true;
    }
    public Snapshot snapshot() { return new Snapshot(this); }

    /** Nonblocking render/lifecycle error notification. The watchdog owns process cleanup. */
    public void signalFailure(String reason) {
        fail(reason == null ? "Frame capture failed" : reason);
        LockSupport.unpark(encoderThread); LockSupport.unpark(watchdogThread);
    }
    /** Nonblocking graceful stop; use stop() on a request worker to wait for MP4 finalization. */
    public void requestStop(String reason) {
        requestStopAt(System.nanoTime(), reason);
    }
    private void requestStopAt(long when, String reason) {
        // Publish STOPPING first: once the encoder sees an end timestamp, its
        // successful completion must be allowed to transition STOPPING -> STOPPED.
        state.compareAndSet(State.RECORDING, State.STOPPING);
        stopReason.compareAndSet(null, reason); stopNanos.compareAndSet(0, when);
        PcmCapture audio = audioCapture;
        if (audio != null) audio.freeze(audioFrames(FrameTimeline.count(stopNanos.get() - startNanos, fps)));
        LockSupport.unpark(encoderThread); LockSupport.unpark(watchdogThread);
    }
    public Snapshot stop(long timeoutMillis) {
        if (timeoutMillis < 1) throw new IllegalArgumentException("Timeout must be positive");
        requestStop("requested");
        boolean done = false;
        try { done = finished.await(timeoutMillis, TimeUnit.MILLISECONDS); }
        catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt(); fail("Interrupted while finalizing recording");
        }
        if (!done) {
            fail("FFmpeg did not finalize within " + timeoutMillis + " ms");
            killProcess(); encoderThread.interrupt(); LockSupport.unpark(encoderThread);
            try { finished.await(500, TimeUnit.MILLISECONDS); }
            catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
        }
        return snapshot();
    }

    private void encode() {
        Frame last = null;
        OutputStream stdin = process.getOutputStream();
        try {
            long index = 0;
            while (true) {
                if (state.get() == State.FAILED) throw new IOException("Recording aborted");
                if (!process.isAlive()) throw new IOException("FFmpeg exited before input was complete");
                if (state.get() == State.RECORDING && System.nanoTime() - startNanos >= limits.durationNanos)
                    requestStopAt(startNanos + limits.durationNanos, "maximum_duration");
                long end = stopNanos.get();
                if (end != 0 && index >= FrameTimeline.count(end - startNanos, fps)) break;
                if (last == null) {
                    last = takeFrame();
                    if (last == null) {
                        if (end != 0 && !isAcceptingPendingFrames()) throw new IOException("No frame was captured before recording stopped");
                        LockSupport.parkNanos(this, TimeUnit.MILLISECONDS.toNanos(10)); continue;
                    }
                }
                long holdback = videoHoldbackNanos();
                long deadline = FrameTimeline.deadline(startNanos, index, fps) + holdback;
                if (end != 0 && holdback != 0) deadline = Math.min(deadline, end + holdback);
                long wait = deadline - System.nanoTime();
                if ((end == 0 || holdback != 0) && wait > 0) {
                    LockSupport.parkNanos(this, Math.min(wait, TimeUnit.MILLISECONDS.toNanos(50))); continue;
                }
                Frame next;
                while ((next = frames.peek()) != null && next.slot <= index) {
                    next = takeFrame(); if (next == null) break;
                    if (next.slot < last.slot) { dropped.incrementAndGet(); recycle(next.buffer, ENCODER); continue; }
                    if (!last.used) dropped.incrementAndGet();
                    recycle(last.buffer, ENCODER); last = next;
                }
                writeStartedNanos.set(System.nanoTime());
                stdin.write(last.buffer.bytes); stdin.flush();
                writeStartedNanos.set(0);
                if (last.used) duplicate.incrementAndGet();
                last.used = true; encoded.incrementAndGet(); index++;
            }
            videoInputClosed = true;
            stdin.close();
            if (!process.waitFor(limits.finalizationMillis, TimeUnit.MILLISECONDS))
                throw new IOException("FFmpeg did not exit after its input closed");
            exitCode = process.exitValue();
            if (exitCode.intValue() != 0) throw new IOException("FFmpeg exited with code " + exitCode);
            if (encoded.get() == 0 || !Files.isRegularFile(partialPath) || Files.size(partialPath) == 0)
                throw new IOException("FFmpeg did not produce a nonempty recording");
            if (state.get() == State.FAILED) throw new IOException("Recording aborted before publication");
            Path publication = partialPath;
            if (audioCapture != null) {
                long samples = audioFrames(encoded.get());
                audioCapture.finish(samples, remainingFinalizationMillis());
                publication = muxAudio(samples);
            }
            if (state.get() == State.FAILED) throw new IOException("Recording aborted before publication");
            publishWithoutOverwrite(publication);
            if (!state.compareAndSet(State.STOPPING, State.STOPPED)) {
                throw new IOException("Recording canceled during publication");
            }
        } catch (Throwable failure) {
            fail(failure.getMessage() == null ? failure.getClass().getSimpleName() : failure.getMessage());
            killProcess();
        } finally {
            writeStartedNanos.set(0);
            if (audioCapture != null) { audioCapture.abort(); audioCapture.delete(); }
            if (state.get() == State.STOPPED && muxPath != null) {
                try { Files.deleteIfExists(partialPath); Files.deleteIfExists(muxPath); } catch (IOException ignored) { }
            }
            if (last != null) recycle(last.buffer, ENCODER);
            Frame queued;
            while ((queued = frames.poll()) != null) {
                queueDepth.decrementAndGet(); dropped.incrementAndGet(); recycle(queued.buffer, QUEUED);
            }
            try { stdin.close(); } catch (IOException ignored) { }
            if (!process.isAlive()) exitCode = process.exitValue();
            try { stderrThread.join(200); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            // If an owned final-looking partial cannot be safely removed, retain the
            // reservation so list() will not advertise it as a completed recording.
            if (state.get() == State.STOPPED || !publishedOutput || !Files.exists(outputPath))
                try { Files.deleteIfExists(reservationPath); } catch (IOException ignored) { }
            try { Runtime.getRuntime().removeShutdownHook(shutdownHook); }
            catch (IllegalStateException ignored) { } catch (SecurityException ignored) { }
            finished.countDown(); LockSupport.unpark(watchdogThread); notifyCompletion();
        }
    }

    private static Map<String, Object> silentAudio() {
        Map<String, Object> audio = new LinkedHashMap<String, Object>();
        audio.put("requested", false); audio.put("enabled", false); audio.put("trackPresent", false); return audio;
    }
    private long audioFrames(long videoFrames) {
        return (videoFrames * AudioCapture.SAMPLE_RATE + fps / 2) / fps;
    }
    private long remainingFinalizationMillis() throws IOException {
        long remaining = TimeUnit.MILLISECONDS.toNanos(limits.finalizationMillis) - (System.nanoTime() - stopNanos.get());
        if (remaining <= 0 || state.get() == State.FAILED) throw new IOException("Recording finalization deadline exceeded");
        return Math.max(1, TimeUnit.NANOSECONDS.toMillis(remaining));
    }
    private Path muxAudio(long samples) throws IOException, InterruptedException {
        remainingFinalizationMillis();
        muxPath = Files.createTempFile(outputPath.getParent(), "." + outputPath.getFileName() + ".", ".audio.partial.mp4");
        Process mux = new ProcessBuilder(executable.toString(), "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                "-i", partialPath.toString(), "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", audioCapture.path.toString(),
                "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
                "-af", "atrim=end_sample=" + samples, "-movflags", "+faststart", muxPath.toString())
                .redirectErrorStream(true).start();
        muxProcess = mux;
        Thread log = daemon("mct-recording-audio-mux-log", new Runnable() {
            @Override public void run() { drainLog(mux.getInputStream()); }
        });
        try {
            log.start();
            if (state.get() == State.FAILED) throw new IOException("Recording aborted before audio mux");
            if (!mux.waitFor(remainingFinalizationMillis(), TimeUnit.MILLISECONDS))
                throw new IOException("Audio mux did not finalize before the recording deadline");
            muxExitCode = mux.exitValue();
            if (muxExitCode.intValue() != 0) throw new IOException("Audio mux FFmpeg exited with code " + muxExitCode);
            if (!Files.isRegularFile(muxPath) || Files.size(muxPath) == 0)
                throw new IOException("Audio mux did not produce a nonempty recording");
            if (Files.size(muxPath) >= limits.maxOutputBytes)
                throw new IOException("Audio mux reached the output size guard; refusing potentially truncated output");
            return muxPath;
        } finally {
            if (mux.isAlive()) mux.destroyForcibly();
            log.join(200);
        }
    }
    private void publishWithoutOverwrite(Path publication) throws IOException {
        // Hard-link publication is atomic, preserves the existing file on all collisions,
        // and needs no second movie-sized allocation or disk copy on normal filesystems.
        try {
            Files.createLink(outputPath, publication);
            publishedOutput = true;
        } catch (FileAlreadyExistsException exists) { throw exists;
        } catch (UnsupportedOperationException unsupported) { copyWithoutOverwrite(publication);
        } catch (IOException linkUnavailable) {
            if (Files.exists(outputPath)) throw new FileAlreadyExistsException(outputPath.toString());
            copyWithoutOverwrite(publication);
        }
        // Cleanup failure must not invalidate an otherwise completed, published movie.
        try { Files.deleteIfExists(publication); } catch (IOException ignored) { }
    }
    private void copyWithoutOverwrite(Path publication) throws IOException {
        // CREATE_NEW is the fallback's no-overwrite boundary, including racing writers.
        try (OutputStream target = Files.newOutputStream(outputPath, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
            publishedOutput = true;
            try (InputStream source = Files.newInputStream(publication)) {
                byte[] bytes = new byte[65536]; int n;
                while ((n = source.read(bytes)) != -1) {
                    if (state.get() == State.FAILED) throw new IOException("Recording canceled during publication");
                    target.write(bytes, 0, n);
                }
            }
        }
    }
    // Never unlink the final public path on failure. A path can be replaced between
    // any Java 8 identity check and deletion. Keeping the reservation instead both
    // preserves external files and hides incomplete fallback copies from list().
    /** One controller listener; registration and completion can race without missing it. */
    void onFinished(Runnable listener) {
        if (!completionListener.compareAndSet(null, listener)) throw new IllegalStateException("Completion listener already installed");
        if (finished.getCount() == 0) notifyCompletion();
    }
    private void notifyCompletion() {
        Runnable listener = completionListener.getAndSet(null);
        if (listener != null) try { listener.run(); } catch (RuntimeException ignored) { }
    }
    private void watch() {
        long nextDiskCheck = 0;
        while (finished.getCount() != 0) {
            long now = System.nanoTime();
            if (state.get() == State.RECORDING && now - startNanos >= limits.durationNanos)
                requestStopAt(startNanos + limits.durationNanos, "maximum_duration");
            if (firstFrameNanos.get() == 0 && now - startNanos >= TimeUnit.MILLISECONDS.toNanos(limits.firstFrameMillis))
                fail("No frame was captured within " + limits.firstFrameMillis + " ms");
            long writing = writeStartedNanos.get();
            if (writing != 0 && now - writing >= TimeUnit.MILLISECONDS.toNanos(limits.stallMillis))
                fail("FFmpeg stopped accepting frames for " + limits.stallMillis + " ms");
            long stopping = stopNanos.get();
            if (state.get() == State.STOPPING && stopping != 0 &&
                    now - stopping >= TimeUnit.MILLISECONDS.toNanos(limits.finalizationMillis))
                fail("FFmpeg finalization deadline exceeded");
            if ((state.get() == State.RECORDING || state.get() == State.STOPPING) && now >= nextDiskCheck) {
                nextDiskCheck = now + TimeUnit.SECONDS.toNanos(1);
                try {
                    if (Files.getFileStore(outputPath.getParent()).getUsableSpace() < limits.minFreeBytes) {
                        if (state.get() == State.STOPPING && audioCapture != null) fail("Insufficient disk space while finalizing game audio");
                        else requestStop("minimum_free_disk_space");
                    } else if (state.get() == State.RECORDING && Files.size(partialPath) >= limits.maxOutputBytes)
                        requestStop("maximum_output_size");
                    Path mux = muxPath;
                    if (mux != null) {
                        try { if (Files.size(mux) >= limits.maxOutputBytes) fail("Audio mux exceeded the output size guard"); }
                        catch (java.nio.file.NoSuchFileException published) { /* Publication removed its temporary. */ }
                    }
                } catch (IOException unavailable) { fail("Recording storage became unavailable: " + unavailable.getMessage()); }
            }
            if (state.get() == State.FAILED) { killProcess(); LockSupport.unpark(encoderThread); }
            LockSupport.parkNanos(this, TimeUnit.MILLISECONDS.toNanos(50));
        }
    }
    private Frame takeFrame() {
        Frame f = frames.poll();
        if (f != null) {
            queueDepth.decrementAndGet();
            if (!f.buffer.owner.compareAndSet(QUEUED, ENCODER)) throw new IllegalStateException("Corrupt queued frame");
        }
        return f;
    }
    private Buffer requireBuffer(byte[] bytes) {
        Buffer b = buffers.get(bytes);
        if (b == null) throw new IllegalArgumentException("Frame was not acquired from this recorder");
        return b;
    }
    private boolean recycle(Buffer b, int owner) {
        if (!b.owner.compareAndSet(owner, FREE)) return false;
        pool.offer(b); return true;
    }
    private void fail(String message) {
        State s;
        do {
            s = state.get(); if (s == State.STOPPED || s == State.FAILED) return;
        } while (!state.compareAndSet(s, State.FAILED));
        error.compareAndSet(null, message.length() > 2048 ? message.substring(0, 2048) : message);
        stopNanos.compareAndSet(0, System.nanoTime());
    }
    private void killProcess() {
        PcmCapture audio = audioCapture; if (audio != null) audio.abort();
        Process mux = muxProcess; if (mux != null && mux.isAlive()) mux.destroyForcibly();
        if (!process.isAlive()) return;
        // destroy() can block on a pipe held by a hung child; kill directly on failure.
        process.destroyForcibly();
        try { process.waitFor(200, TimeUnit.MILLISECONDS); }
        catch (InterruptedException interrupted) { process.destroyForcibly(); Thread.currentThread().interrupt(); }
    }
    private void drainLog(InputStream stream) {
        try (InputStreamReader reader = new InputStreamReader(stream, StandardCharsets.UTF_8)) {
            char[] chars = new char[1024]; int count;
            while ((count = reader.read(chars)) >= 0) synchronized (diagnostics) {
                diagnostics.append(chars, 0, count);
                if (diagnostics.length() > 8192) diagnostics.delete(0, diagnostics.length() - 8192);
            }
        } catch (IOException ignored) { }
    }
    private String logTail() { synchronized (diagnostics) { return diagnostics.toString(); } }
}
