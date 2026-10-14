package com.mct.core.recording;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/** Opt-in tee of the actual game mixer. No microphone, desktop capture, or sound synthesis. */
public final class AudioCapture {
    public static final int SAMPLE_RATE = 48000, CHANNELS = 2, BYTES_PER_FRAME = 4;
    public static final int MAX_BLOCK_FRAMES = 9600, QUEUE_CAPACITY = 32;
    public interface Provider {
        String name();
        /** Null means the continuous game-mix source is ready. */
        String unavailableReason();
    }
    private static final AtomicReference<Provider> PROVIDER = new AtomicReference<Provider>();
    private static final AtomicReference<PcmCapture> ACTIVE = new AtomicReference<PcmCapture>();
    private static volatile String lastUnavailable = "No game audio capture provider is registered";
    private AudioCapture() { }
    public static boolean isRequested() { return Boolean.getBoolean("mct.record.audio"); }
    public static void register(Provider provider) {
        if (provider == null) throw new IllegalArgumentException("Audio provider is required");
        Provider old = PROVIDER.getAndSet(provider);
        if (old != null && old != provider) signalFailure(old, "Game audio provider was replaced");
    }
    public static void unregister(Provider provider, String reason) {
        if (provider != null && PROVIDER.compareAndSet(provider, null)) {
            lastUnavailable = reason == null ? "Game audio capture provider stopped" : reason;
            signalFailure(provider, lastUnavailable);
        }
    }
    /** Copies before return. False means inactive, stale, stopped, or bounded-queue pressure. */
    public static boolean submit(Provider provider, byte[] pcm, int byteOffset, int sampleFrames, long firstSampleNanos) {
        PcmCapture active = ACTIVE.get();
        return active != null && provider == active.provider && provider == PROVIDER.get() &&
                active.submit(pcm, byteOffset, sampleFrames, firstSampleNanos);
    }
    public static void signalFailure(Provider provider, String reason) {
        PcmCapture active = ACTIVE.get();
        if (active != null && active.provider == provider)
            active.fail(reason == null ? "Game audio capture failed" : reason);
    }
    static Provider requireProvider() throws IOException {
        Provider provider = PROVIDER.get(); String reason = reason(provider);
        if (reason != null) throw new IOException("Requested game audio is unavailable: " + reason);
        return provider;
    }
    static void attach(PcmCapture capture) throws IOException {
        if (requireProvider() != capture.provider) throw new IOException("Game audio provider changed during startup");
        if (!ACTIVE.compareAndSet(null, capture)) throw new IOException("Another game audio recording is active");
        if (PROVIDER.get() != capture.provider) {
            detach(capture); throw new IOException("Game audio provider stopped during startup");
        }
    }
    static void detach(PcmCapture capture) { ACTIVE.compareAndSet(capture, null); }
    private static String reason(Provider provider) {
        if (provider == null) return lastUnavailable;
        try { return provider.unavailableReason(); }
        catch (RuntimeException failure) { return "Game audio health check failed: " + failure.getClass().getSimpleName(); }
    }
    public static Map<String, Object> capabilities() {
        Provider provider = PROVIDER.get(); String reason = reason(provider);
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        m.put("requested", isRequested()); m.put("available", reason == null);
        m.put("source", provider == null ? null : provider.name()); m.put("unavailableReason", reason);
        m.put("sampleRate", SAMPLE_RATE); m.put("channels", CHANNELS); m.put("format", "s16le");
        m.put("codec", "aac"); m.put("bitrate", 128000);
        m.put("queueCapacity", QUEUE_CAPACITY); m.put("maxBlockFrames", MAX_BLOCK_FRAMES); return m;
    }
}
