package com.mct.core.recording;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.DirectoryStream;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * One recording per Minecraft process, independent of WebSocket connections/worlds.
 * Thin render adapters only update source metadata and borrow/submit RGBA captures.
 * handle() belongs on the connection request worker, never Minecraft's client thread.
 * No Minecraft, OpenGL, networking or JSON dependency is used by this controller.
 */
public final class RecordingController {
    private static final RecordingController INSTANCE = new RecordingController();
    private static final Set<String> START_KEYS = Collections.unmodifiableSet(new HashSet<String>(
            Arrays.asList("name", "width", "height", "fps", "maxDurationSeconds")));
    private static final int MAX_LIST_ITEMS = 1000;

    public static final class RecordingException extends RuntimeException {
        private static final long serialVersionUID = 1L;
        private final String code;
        RecordingException(String code, String message) { super(message); this.code = code; }
        RecordingException(String code, String message, Throwable cause) { super(message, cause); this.code = code; }
        public String getCode() { return code; }
    }
    /** Owned by its original session even after stop/restart; submit or release exactly once. */
    public static final class Capture {
        public final byte[] bytes;
        public final int width, height, fps;
        public final long sessionId;
        private final RawFrameRecorder owner;
        private final AtomicBoolean borrowed = new AtomicBoolean(true);
        private Capture(RawFrameRecorder owner, byte[] bytes) {
            this.owner = owner; this.bytes = bytes; this.sessionId = owner.getSessionId();
            width = owner.getWidth(); height = owner.getHeight(); fps = owner.getFps();
        }
    }
    private static final class Source {
        final Path directory;
        final int width, height, rendererFps;
        Source(Path directory, int width, int height, int rendererFps) {
            this.directory = directory; this.width = width; this.height = height; this.rendererFps = rendererFps;
        }
    }
    private static final class Metrics {
        final String backend;
        final boolean pending;
        final long busyDrops;
        final double averageMs, maximumMs;
        Metrics(String backend, boolean pending, long drops, double average, double maximum) {
            this.backend = backend; this.pending = pending; busyDrops = drops; averageMs = average; maximumMs = maximum;
        }
    }
    interface RecorderFactory {
        RawFrameRecorder create(Path path, int width, int height, int fps, int duration) throws IOException;
    }
    private final RecorderFactory factory;
    private final Object control = new Object();
    private final AtomicLong lifecycleEpoch = new AtomicLong();
    private volatile Source source = new Source(null, 0, 0, 0);
    private volatile Metrics metrics = new Metrics("minecraft-final-framebuffer", false, 0, 0, 0);
    private volatile boolean gpuReadbackAllocated;
    private volatile RawFrameRecorder recorder;
    private volatile Map<String, Object> lastResult;
    private volatile Map<String, Object> lastControlError;
    private volatile String sessionName;
    private volatile int maxDurationSeconds = RawFrameRecorder.DEFAULT_DURATION_SECONDS;

    public static RecordingController getInstance() { return INSTANCE; }
    /** Public to allow isolated embedding/tests; production adapters should use getInstance(). */
    public RecordingController() {
        this(new RecorderFactory() {
            @Override public RawFrameRecorder create(Path path, int width, int height, int fps, int duration) throws IOException {
                return RawFrameRecorder.start(path, width, height, fps, duration);
            }
        });
    }
    RecordingController(RecorderFactory factory) { this.factory = factory; }

    /** Call at each completed render, using the actual framebuffer pixel dimensions. */
    public void updateSource(Path gameDirectory, int width, int height) {
        updateSource(gameDirectory, width, height, source.rendererFps);
    }
    public void updateSource(Path gameDirectory, int width, int height, int rendererFps) {
        Source old = source;
        Path directory = gameDirectory == null ? null : gameDirectory.toAbsolutePath().normalize().resolve("recordings");
        if (width != old.width || height != old.height || rendererFps != old.rendererFps ||
                (directory == null ? old.directory != null : !directory.equals(old.directory)))
            source = new Source(directory, width, height, Math.max(0, rendererFps));
        RawFrameRecorder active = recorder;
        if (active != null && active.isAcceptingFrames() &&
                (width != active.getWidth() || height != active.getHeight()))
            active.signalFailure("Framebuffer resized from " + active.getWidth() + "x" + active.getHeight() +
                    " to " + width + "x" + height + "; recording requires fixed native dimensions");
    }
    public void updateRendererMetrics(String backend, boolean readbackPending, long busyDrops,
                                      double copyAverageMs, double copyMaxMs) {
        metrics = new Metrics(backend == null ? "minecraft-final-framebuffer" : backend,
                readbackPending, Math.max(0, busyDrops), Math.max(0, copyAverageMs), Math.max(0, copyMaxMs));
    }
    public void updateReadbackAllocated(boolean allocated) { gpuReadbackAllocated = allocated; }
    /** Sampling and pool acquisition are nonblocking; no image-sized allocations occur here. */
    public Capture acquireFrame(long nowNanos) {
        RawFrameRecorder active = recorder;
        if (active == null || !active.sampleDue(nowNanos)) return null;
        byte[] bytes = active.acquireFrame();
        return bytes == null ? null : new Capture(active, bytes);
    }
    public boolean isAccepting(Capture capture) {
        return capture != null && capture.borrowed.get() && recorder == capture.owner && capture.owner.isAcceptingFrames();
    }
    public boolean submitFrame(Capture capture, long captureNanos) {
        requireBorrowed(capture);
        return capture.owner.submitFrame(capture.bytes, captureNanos);
    }
    public void releaseFrame(Capture capture) {
        requireBorrowed(capture); capture.owner.releaseFrame(capture.bytes);
    }
    private static void requireBorrowed(Capture capture) {
        if (capture == null || !capture.borrowed.compareAndSet(true, false))
            throw new IllegalArgumentException("Capture was already submitted or released");
    }
    public boolean isRecording() {
        RawFrameRecorder active = recorder; return active != null && active.isAcceptingFrames();
    }
    /** Async capture callbacks should use the owner-specific overload to avoid failing a new session. */
    public void signalFailure(Capture capture, String message) {
        if (capture != null) capture.owner.signalFailure(message);
    }
    public void signalFailure(String message) {
        RawFrameRecorder active = recorder; if (active != null) active.signalFailure(message);
    }
    /** Gracefully freeze capture now; the core watchdog bounds finalization even without another request. */
    public void cancel(String reason) {
        lifecycleEpoch.incrementAndGet();
        RawFrameRecorder active = recorder; if (active != null) active.requestStop(reason == null ? "client_shutdown" : reason);
    }

    /** Request-worker entry point. Status/list do not interrupt, stop or take ownership of a session. */
    public Map<String, Object> handle(String command, Map<String, Object> arguments) {
        try { return handleCommand(command, arguments); }
        catch (RecordingException failure) {
            Map<String, Object> detail = new LinkedHashMap<String, Object>();
            detail.put("code", failure.getCode()); detail.put("message", failure.getMessage());
            lastControlError = detail;
            throw failure;
        }
    }
    private Map<String, Object> handleCommand(String command, Map<String, Object> arguments) {
        Map<String, Object> args = arguments == null ? Collections.<String, Object>emptyMap() : arguments;
        if ("recording.status".equals(command)) { requireNoArguments(args); return status(); }
        if ("recording.list".equals(command)) { requireNoArguments(args); return list(); }
        if ("recording.start".equals(command)) return start(args);
        if ("recording.stop".equals(command)) {
            requireNoArguments(args);
            synchronized (control) {
                RawFrameRecorder active = recorder;
                if (active == null) {
                    if (lastResult != null) return status();
                    throw error("RECORDING_NOT_STARTED", "No recording has been started in this client");
                }
                lastResult = active.stop(RawFrameRecorder.STOP_TIMEOUT_MILLIS).toMap();
                recorder = null; // A pending GPU Capture alone keeps its original buffers alive.
                return status();
            }
        }
        throw error("INVALID_ACTION", "Unsupported recording action: " + command);
    }
    private Map<String, Object> start(Map<String, Object> args) {
        final long startupEpoch = lifecycleEpoch.get();
        for (String key : args.keySet()) if (!START_KEYS.contains(key))
            throw error("INVALID_PARAMS", "Unsupported recording parameter: " + key);
        final int width = integer(args, "width", RawFrameRecorder.DEFAULT_WIDTH, 2, RawFrameRecorder.MAX_WIDTH);
        final int height = integer(args, "height", RawFrameRecorder.DEFAULT_HEIGHT, 2, RawFrameRecorder.MAX_HEIGHT);
        final int fps = integer(args, "fps", RawFrameRecorder.DEFAULT_FPS, 1, RawFrameRecorder.MAX_FPS);
        final int duration = integer(args, "maxDurationSeconds", RawFrameRecorder.DEFAULT_DURATION_SECONDS,
                1, RawFrameRecorder.MAX_DURATION_SECONDS);
        try { RawFrameRecorder.validateDimensions(width, height, fps); }
        catch (IllegalArgumentException invalid) { throw error("INVALID_PARAMS", invalid.getMessage()); }
        final String name;
        if (args.containsKey("name")) {
            if (!(args.get("name") instanceof String)) throw error("INVALID_PARAMS", "name must be a string");
            name = (String) args.get("name");
        } else name = "mct-" + new SimpleDateFormat("yyyyMMdd-HHmmss-SSS", Locale.ROOT).format(new Date());
        if (!validName(name)) throw error("INVALID_PARAMS", "name must be 1-80 letters, digits, underscores or hyphens, starting with a letter or digit, without an extension");
        synchronized (control) {
            if (Thread.currentThread().isInterrupted()) throw error("RECORDING_START_FAILED", "Recording request was canceled before start");
            RawFrameRecorder old = recorder;
            if (old != null) {
                RawFrameRecorder.State state = old.snapshot().state;
                if (state == RawFrameRecorder.State.STARTING || state == RawFrameRecorder.State.RECORDING || state == RawFrameRecorder.State.STOPPING)
                    throw error("RECORDING_ALREADY_ACTIVE", "Stop the current recording before starting another");
                // Wait only for a failed encoder's bounded cleanup, never on the render thread.
                lastResult = old.stop(1000).toMap(); recorder = null;
            }
            Source s = source;
            if (s.directory == null || s.width < 2 || s.height < 2)
                throw error("RECORDING_SOURCE_UNAVAILABLE", "A rendered Minecraft framebuffer is not available yet");
            if (s.width != width || s.height != height)
                throw error("RECORDING_FRAMEBUFFER_MISMATCH", "Requested " + width + "x" + height +
                        " but the native framebuffer is " + s.width + "x" + s.height + "; resize the game or relaunch with mct client launch <client> --width " + width + " --height " + height + " and recheck recording.status (HiDPI can change physical framebuffer dimensions), or request the current even native dimensions");
            try { RawFrameRecorder.ffmpegExecutable(); }
            catch (IOException missing) { throw new RecordingException("RECORDING_FFMPEG_UNAVAILABLE", missing.getMessage(), missing); }
            if (lifecycleEpoch.get() != startupEpoch)
                throw error("RECORDING_START_FAILED", "Recording request was canceled before startup");
            RawFrameRecorder created = null;
            try {
                created = factory.create(s.directory.resolve(name + ".mp4"), width, height, fps, duration);
                if (Thread.currentThread().isInterrupted() || lifecycleEpoch.get() != startupEpoch) {
                    created.signalFailure("Recording request was canceled during startup");
                    created.stop(1000);
                    throw error("RECORDING_START_FAILED", "Recording request was canceled during startup");
                }
                // Publish only after allocation/process startup has finished. Rendering sees an immutable session.
                sessionName = name; maxDurationSeconds = duration; lastResult = null; lastControlError = null; recorder = created;
                final RawFrameRecorder published = created;
                created.onFinished(new Runnable() {
                    @Override public void run() {
                        synchronized (control) {
                            if (recorder == published) {
                                lastResult = published.snapshot().toMap(); recorder = null;
                            }
                        }
                    }
                });
                // Covers a lifecycle cancellation between the previous check and publication.
                if (lifecycleEpoch.get() != startupEpoch) created.requestStop("client_shutdown_during_start");
                Source latest = source;
                if (latest.width != width || latest.height != height)
                    created.signalFailure("Framebuffer resized during recording startup");
                return status();
            } catch (FileAlreadyExistsException exists) {
                throw new RecordingException("RECORDING_FILE_EXISTS", "Recording name already exists: " + name, exists);
            } catch (IOException failure) {
                throw new RecordingException("RECORDING_START_FAILED", failure.getMessage(), failure);
            }
        }
    }
    public Map<String, Object> status() {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        RawFrameRecorder active = recorder;
        Map<String, Object> previous = lastResult;
        if (active != null) result.putAll(active.snapshot().toMap());
        else if (previous != null) result.putAll(previous);
        else {
            result.put("state", "idle"); result.put("finalized", false);
            result.put("width", RawFrameRecorder.DEFAULT_WIDTH); result.put("height", RawFrameRecorder.DEFAULT_HEIGHT);
            result.put("fps", RawFrameRecorder.DEFAULT_FPS); result.put("captured", 0L); result.put("encoded", 0L);
            result.put("duplicate", 0L); result.put("dropped", 0L); result.put("elapsedSeconds", 0.0);
            result.put("capturedFps", 0.0); result.put("error", null); result.put("stopReason", null);
        }
        Source s = source; Metrics m = metrics;
        result.put("name", sessionName); result.put("supported", true); result.put("audio", false); result.put("upscaled", false);
        result.put("sourceWidth", s.width); result.put("sourceHeight", s.height); result.put("rendererFps", s.rendererFps);
        result.put("directory", s.directory == null ? null : s.directory.toString());
        result.put("maxDurationSeconds", maxDurationSeconds); result.put("captureBackend", m.backend);
        result.put("gpuReadbackAllocated", gpuReadbackAllocated);
        result.put("readbackPending", m.pending); result.put("readbackBusyDrops", m.busyDrops);
        result.put("copyAverageMs", m.averageMs); result.put("copyMaxMs", m.maximumMs);
        result.put("lastControlError", lastControlError);
        result.put("capabilities", capabilities()); return result;
    }
    private static Map<String, Object> capabilities() {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        try { result.put("ffmpegExecutable", RawFrameRecorder.ffmpegExecutable().toString()); result.put("ffmpegAvailable", true); }
        catch (IOException unavailable) { result.put("ffmpegAvailable", false); result.put("ffmpegError", unavailable.getMessage()); }
        result.put("formats", Collections.singletonList("mp4")); result.put("codec", "h264");
        result.put("pixelFormat", "yuv420p"); result.put("audio", false); result.put("nativeFramebufferRequired", true);
        Map<String, Object> defaults = new LinkedHashMap<String, Object>();
        defaults.put("width", RawFrameRecorder.DEFAULT_WIDTH); defaults.put("height", RawFrameRecorder.DEFAULT_HEIGHT);
        defaults.put("fps", RawFrameRecorder.DEFAULT_FPS); defaults.put("maxDurationSeconds", RawFrameRecorder.DEFAULT_DURATION_SECONDS);
        result.put("defaults", defaults);
        Map<String, Object> limits = new LinkedHashMap<String, Object>();
        limits.put("minWidth", 2); limits.put("minHeight", 2); limits.put("evenDimensionsRequired", true);
        limits.put("maxWidth", RawFrameRecorder.MAX_WIDTH); limits.put("maxHeight", RawFrameRecorder.MAX_HEIGHT);
        limits.put("minFps", 1); limits.put("maxFps", RawFrameRecorder.MAX_FPS);
        limits.put("maxMemoryBytes", RawFrameRecorder.MAX_MEMORY_BYTES); limits.put("poolSize", RawFrameRecorder.POOL_SIZE);
        limits.put("queueCapacity", RawFrameRecorder.QUEUE_CAPACITY); limits.put("maxDurationSeconds", RawFrameRecorder.MAX_DURATION_SECONDS);
        limits.put("maxOutputBytes", RawFrameRecorder.MAX_OUTPUT_BYTES); limits.put("minFreeBytes", RawFrameRecorder.MIN_FREE_BYTES);
        limits.put("firstFrameTimeoutMillis", RawFrameRecorder.FIRST_FRAME_TIMEOUT_MILLIS);
        limits.put("stopTimeoutMillis", RawFrameRecorder.STOP_TIMEOUT_MILLIS); result.put("limits", limits);
        return result;
    }
    private Map<String, Object> list() {
        Source s = source;
        List<Map<String, Object>> entries = new ArrayList<Map<String, Object>>();
        boolean truncated = false;
        if (s.directory != null && Files.isDirectory(s.directory)) {
            try (DirectoryStream<Path> files = Files.newDirectoryStream(s.directory, "*.mp4")) {
                for (Path file : files) {
                    String filename = file.getFileName().toString();
                    String name = filename.substring(0, filename.length() - 4);
                    if (!validName(name) || !Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) continue;
                    // The fallback publication copy can be visible while it is still running.
                    // A reservation also protects crash-left unfinished copies from being listed.
                    if (Files.exists(file.resolveSibling(filename + ".mct-recording.lock"), LinkOption.NOFOLLOW_LINKS)) continue;
                    if (entries.size() == MAX_LIST_ITEMS) { truncated = true; break; }
                    BasicFileAttributes attrs = Files.readAttributes(file, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
                    if (attrs.size() == 0) continue;
                    Map<String, Object> entry = new LinkedHashMap<String, Object>();
                    entry.put("name", name); entry.put("outputPath", file.toAbsolutePath().toString());
                    entry.put("sizeBytes", attrs.size()); entry.put("modifiedAt", attrs.lastModifiedTime().toInstant().toString());
                    entry.put("finalized", true); entries.add(entry);
                }
            } catch (IOException failure) { throw new RecordingException("RECORDING_LIST_FAILED", failure.getMessage(), failure); }
        }
        Collections.sort(entries, new Comparator<Map<String, Object>>() {
            @Override public int compare(Map<String, Object> a, Map<String, Object> b) {
                return b.get("modifiedAt").toString().compareTo(a.get("modifiedAt").toString());
            }
        });
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("recordings", entries); result.put("directory", s.directory == null ? null : s.directory.toString());
        result.put("truncated", truncated); result.put("limit", MAX_LIST_ITEMS); result.put("supported", true); return result;
    }
    static boolean validName(String name) {
        if (!name.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,79}")) return false;
        return !name.toUpperCase(Locale.ROOT).matches("CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]");
    }
    private static int integer(Map<String, Object> args, String key, int fallback, int min, int max) {
        if (!args.containsKey(key)) return fallback;
        Object raw = args.get(key);
        if (!(raw instanceof Number)) throw error("INVALID_PARAMS", key + " must be an integer");
        try {
            String token = raw.toString();
            if (token.length() > 64) throw new NumberFormatException();
            BigDecimal decimal = new BigDecimal(token);
            if (decimal.scale() < -8 || decimal.scale() > 64) throw new NumberFormatException();
            int value = decimal.intValueExact();
            if (value < min || value > max) throw new NumberFormatException();
            return value;
        } catch (ArithmeticException invalid) { throw error("INVALID_PARAMS", key + " must be an integer from " + min + " to " + max);
        } catch (NumberFormatException invalid) { throw error("INVALID_PARAMS", key + " must be an integer from " + min + " to " + max); }
    }
    private static void requireNoArguments(Map<String, Object> args) {
        if (!args.isEmpty()) throw error("INVALID_PARAMS", "This recording action accepts no parameters");
    }
    private static RecordingException error(String code, String message) { return new RecordingException(code, message); }
}
