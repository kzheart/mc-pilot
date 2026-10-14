package com.mct.audio;

import com.mct.core.recording.AudioCapture;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.IntBuffer;
import java.util.ArrayDeque;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.locks.ReentrantLock;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.LockSupport;
import org.lwjgl.BufferUtils;
import org.lwjgl.openal.AL;
import org.lwjgl.openal.ALCCapabilities;
import org.lwjgl.openal.ALC;
import org.lwjgl.system.MemoryStack;
import static org.lwjgl.openal.AL10.*;
import static org.lwjgl.openal.ALC10.*;
import static org.lwjgl.openal.EXTThreadLocalContext.*;
import static org.lwjgl.openal.EnumerateAllExt.ALC_ALL_DEVICES_SPECIFIER;
import static org.lwjgl.openal.SOFTLoopback.*;
import static org.lwjgl.openal.SOFTHRTF.ALC_HRTF_SOFT;

/**
 * Minecraft 1.20.1's actual OpenAL mix, rendered once and sent both to the recorder
 * and to ordinary playback. No microphone, OS loopback or synthesized sound events.
 * Minecraft owns the returned loopback device/context; this owns only the output tee.
 */
public final class GameAudioCapture implements AudioCapture.Provider {
    private static final int RATE = 48_000;
    private static final int FRAMES = 480;
    private static final int BYTES = FRAMES * 2 * 2;
    private static final long BLOCK_NANOS = 10_000_000L;
    private static final int PLAYBACK_BUFFERS = 12;
    private static final System.Logger LOG = System.getLogger("mct.game-audio");

    private final Executor soundExecutor;
    private final ReentrantLock renderLock = new ReentrantLock();
    private final CountDownLatch outputReady = new CountDownLatch(1);
    private final CountDownLatch gameReady = new CountDownLatch(1);
    private volatile String unavailable = "Minecraft sound engine is initializing";
    private volatile boolean stopping;
    private volatile boolean failed;
    private volatile boolean outputInitialized;
    private volatile boolean started;
    private long gameDevice;
    private long gameContext;
    private long outputDevice;
    private long outputContext;
    private volatile String outputDeviceName;
    private ALCCapabilities gameCaps;
    private ALCCapabilities outputCaps;
    private boolean deviceTransferred;
    private boolean contextTransferred;
    private Thread pump;
    private volatile long clockResyncs;
    private volatile long clockGapNanos;
    private volatile long maximumExecutorWaitNanos;
    private volatile long maximumTimestampLagNanos;

    public GameAudioCapture(Executor soundExecutor) {
        this.soundExecutor = soundExecutor;
        AudioCapture.register(this);
    }

    @Override public String name() { return "minecraft-openal-soft-loopback"; }
    @Override public String unavailableReason() { return unavailable; }

    /** Return zero to leave Minecraft's original device selection untouched. */
    public long open(String requestedOutput, boolean directionalAudio) {
        ALCCapabilities previous = ALC.getCapabilities();
        try {
            if (soundExecutor == null) throw new IllegalStateException("Minecraft sound executor was not bound");
            if (!alcIsExtensionPresent(0L, "ALC_SOFT_loopback")) {
                throw new IllegalStateException("OpenAL Soft loopback is not supported");
            }
            gameDevice = alcLoopbackOpenDeviceSOFT((ByteBuffer) null);
            if (gameDevice == 0L) throw new IllegalStateException("Could not open game-mix loopback");
            gameCaps = ALC.createCapabilities(gameDevice);
            if (!alcIsRenderFormatSupportedSOFT(gameDevice, RATE, ALC_STEREO_SOFT, ALC_SHORT_SOFT)) {
                throw new IllegalStateException("48 kHz stereo S16 loopback is unsupported");
            }
            try (MemoryStack stack = MemoryStack.stackPush()) {
                IntBuffer attrs = stack.callocInt(11);
                attrs.put(ALC_FREQUENCY).put(RATE)
                    .put(ALC_FORMAT_CHANNELS_SOFT).put(ALC_STEREO_SOFT)
                    .put(ALC_FORMAT_TYPE_SOFT).put(ALC_SHORT_SOFT);
                if (gameCaps.ALC_SOFT_HRTF) attrs.put(ALC_HRTF_SOFT).put(directionalAudio ? 1 : 0);
                attrs.put(0).flip();
                gameContext = alcCreateContext(gameDevice, attrs);
            }
            if (gameContext == 0L) throw new IllegalStateException("Could not create game-mix context");

            // Never divert the game to a loopback if ordinary audio cannot be retained.
            outputDevice = alcOpenDevice(requestedOutput == null || requestedOutput.isEmpty()
                ? (CharSequence) null : requestedOutput);
            if (outputDevice == 0L && requestedOutput != null && !requestedOutput.isEmpty()) {
                outputDevice = alcOpenDevice((CharSequence) null);
            }
            if (outputDevice == 0L) throw new IllegalStateException("Could not open ordinary game-audio output");
            outputCaps = ALC.createCapabilities(outputDevice);
            outputDeviceName = outputCaps.ALC_ENUMERATE_ALL_EXT
                ? alcGetString(outputDevice, ALC_ALL_DEVICES_SPECIFIER) : null;
            if (outputDeviceName == null) outputDeviceName = alcGetString(outputDevice, ALC_DEVICE_SPECIFIER);
            if (outputDeviceName == null) outputDeviceName = "Unknown";
            if (!outputCaps.ALC_EXT_thread_local_context) {
                throw new IllegalStateException("Thread-local OpenAL output context is unsupported");
            }
            try (MemoryStack stack = MemoryStack.stackPush()) {
                outputContext = alcCreateContext(outputDevice, stack.ints(ALC_FREQUENCY, RATE, 0));
            }
            if (outputContext == 0L) throw new IllegalStateException("Could not create ordinary audio output context");
            pump = new Thread(this::runPump, "mct-game-audio-48khz");
            pump.setDaemon(true);
            pump.start();
            if (!outputReady.await(5, TimeUnit.SECONDS) || !outputInitialized) {
                throw new IllegalStateException(unavailable == null ? "Audio output initialization timed out" : unavailable);
            }
            deviceTransferred = true;
            return gameDevice;
        } catch (Throwable error) {
            fail("Game-mix capture unavailable: " + describe(error));
            stopPump();
            releaseUntransferredGame();
            if (pump == null) releaseOutput();
            return 0L;
        } finally {
            ALC.setCapabilities(previous);
        }
    }

    public boolean owns(long device) { return device != 0L && deviceTransferred && device == gameDevice; }

    public long context(long device) {
        if (!owns(device)) throw new IllegalArgumentException("Not the recording device");
        contextTransferred = true;
        return gameContext;
    }

    public void start(long device, long context) {
        if (!owns(device) || context != gameContext || failed) return;
        started = true;
        unavailable = null;
        gameReady.countDown();
        LOG.log(System.Logger.Level.INFO,
            "Capturing Minecraft OpenAL mix: 48000 Hz, stereo S16; ordinary playback tee active");
    }

    /** Causes Minecraft's existing sound-device recovery to reload a failed tee. */
    public boolean needsReload() { return started && failed; }

    /** Preserve vanilla's preferred-device comparison; the internal mixer is named Loopback. */
    public String outputDeviceName() { return outputDeviceName; }

    public boolean close() {
        if (!stopPump()) return false;
        unavailable = "Minecraft sound engine closed or reloaded";
        AudioCapture.unregister(this, unavailable);
        releaseUntransferredGame();
        LOG.log(System.Logger.Level.INFO, "Game-mix timing: " + timingStats());
        return true;
    }

    private boolean stopPump() {
        stopping = true;
        gameReady.countDown();
        if (pump == null) return true;
        if (pump == Thread.currentThread()) return false;
        LockSupport.unpark(pump);
        boolean interrupted = false;
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        while (pump.isAlive() && System.nanoTime() < deadline) {
            try { pump.join(Math.max(1L, TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime()))); }
            catch (InterruptedException ignored) { interrupted = true; }
        }
        boolean safe = false;
        if (!pump.isAlive()) {
            try {
                safe = renderLock.tryLock(Math.max(1L, deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
                if (safe) renderLock.unlock();
            } catch (InterruptedException ignored) { interrupted = true; }
        }
        if (interrupted) Thread.currentThread().interrupt();
        if (!safe) fail("Game audio shutdown timed out; native device destruction deferred for safety");
        return safe;
    }

    private void runPump() {
        int source = 0;
        int[] buffers = new int[PLAYBACK_BUFFERS];
        try {
            ALC.setCapabilities(outputCaps);
            if (!alcSetThreadContext(outputContext)) throw new IllegalStateException("Cannot bind output context");
            AL.createCapabilities(outputCaps); // Thread-local; never changes the Minecraft process context.
            source = alGenSources();
            alSourcei(source, AL_SOURCE_RELATIVE, AL_TRUE);
            alSourcef(source, AL_ROLLOFF_FACTOR, 0f);
            alSourcef(source, AL_GAIN, 1f); // The game's listener gain is already present in this PCM.
            ArrayDeque<Integer> free = new ArrayDeque<>();
            for (int i = 0; i < buffers.length; i++) {
                buffers[i] = alGenBuffers();
                free.addLast(buffers[i]);
            }
            checkAl("create playback tee");
            outputInitialized = true;
            outputReady.countDown();
            gameReady.await();
            if (stopping) return;

            ByteBuffer pcm = BufferUtils.createByteBuffer(BYTES).order(ByteOrder.nativeOrder());
            byte[] littleEndian = new byte[BYTES];
            long nextSampleNanos = System.nanoTime();
            while (!stopping) {
                long wait = nextSampleNanos - System.nanoTime();
                if (wait > 0) {
                    LockSupport.parkNanos(wait);
                    continue;
                }
                pcm.clear();
                // Rendering itself is a sound-executor task, after actual source mutations.
                // A barrier followed by rendering here would leave a mutation/render race.
                long firstSampleNanos = renderOnSoundExecutor(pcm, nextSampleNanos);
                if (stopping) break;
                nextSampleNanos = firstSampleNanos + BLOCK_NANOS;
                // OpenAL returns native-endian shorts. The recorder contract is always little-endian.
                if (ByteOrder.nativeOrder() == ByteOrder.LITTLE_ENDIAN) {
                    pcm.get(littleEndian).rewind();
                } else {
                    for (int i = 0; i < BYTES; i += 2) {
                        short sample = pcm.getShort(i);
                        littleEndian[i] = (byte) sample;
                        littleEndian[i + 1] = (byte) (sample >>> 8);
                    }
                }
                AudioCapture.submit(this, littleEndian, 0, FRAMES, firstSampleNanos);

                ALC.setCapabilities(outputCaps);
                int processed = alGetSourcei(source, AL_BUFFERS_PROCESSED);
                while (processed-- > 0) free.addLast(alSourceUnqueueBuffers(source));
                if (free.isEmpty()) {
                    // Output clock drift must not accumulate seconds of playback latency.
                    alSourceStop(source);
                    int queued = alGetSourcei(source, AL_BUFFERS_QUEUED);
                    while (queued-- > 0) free.addLast(alSourceUnqueueBuffers(source));
                }
                int buffer = free.removeFirst();
                alBufferData(buffer, AL_FORMAT_STEREO16, pcm, RATE);
                alSourceQueueBuffers(source, buffer);
                if (alGetSourcei(source, AL_SOURCE_STATE) != AL_PLAYING
                    && alGetSourcei(source, AL_BUFFERS_QUEUED) >= 3) {
                    alSourcePlay(source);
                }
                checkAl("play game-mix tee");
                if (outputCaps.ALC_EXT_disconnect && alcGetInteger(outputDevice, 0x313) == 0) {
                    throw new IllegalStateException("Ordinary game-audio output disconnected");
                }
            }
        } catch (Throwable error) {
            if (!stopping) fail("Game-mix capture failed: " + describe(error));
        } finally {
            outputReady.countDown();
            try {
                ALC.setCapabilities(outputCaps);
                if (source != 0) { alSourceStop(source); alDeleteSources(source); }
                for (int buffer : buffers) if (buffer != 0) alDeleteBuffers(buffer);
            } catch (Throwable cleanupError) {
                LOG.log(System.Logger.Level.WARNING, "Could not clean up audio tee", cleanupError);
            }
            try { alcSetThreadContext(0L); AL.setCurrentThread(null); }
            finally { releaseOutput(); ALC.setCapabilities(null); }
        }
    }

    private long renderOnSoundExecutor(ByteBuffer pcm, long scheduledSampleNanos) throws Exception {
        CompletableFuture<Long> completion = new CompletableFuture<>();
        long enqueuedAt = System.nanoTime();
        soundExecutor.execute(() -> {
            renderLock.lock();
            try {
                if (stopping || completion.isDone()) return;
                long renderAt = System.nanoTime();
                maximumExecutorWaitNanos = Math.max(maximumExecutorWaitNanos, renderAt - enqueuedAt);
                if (renderAt - enqueuedAt > TimeUnit.MILLISECONDS.toNanos(100)) {
                    throw new IllegalStateException("Minecraft sound executor stalled over 100 ms");
                }
                ALCCapabilities previous = ALC.getCapabilities();
                try {
                    ALC.setCapabilities(gameCaps);
                    alcRenderSamplesSOFT(gameDevice, pcm, FRAMES);
                    int error = alcGetError(gameDevice);
                    if (error != ALC_NO_ERROR) throw new IllegalStateException("OpenAL game-mix render error " + error);
                } finally { ALC.setCapabilities(previous); }
                // Keep the sample-count clock through normal scheduler jitter. A block may
                // never inherit more than one block of historical time; missed deadlines
                // resync forward once, never render a catch-up burst with new source state.
                long firstSampleNanos = scheduledSampleNanos;
                if (renderAt - firstSampleNanos > BLOCK_NANOS) {
                    clockResyncs++;
                    clockGapNanos += renderAt - firstSampleNanos;
                    firstSampleNanos = renderAt;
                }
                maximumTimestampLagNanos = Math.max(maximumTimestampLagNanos, renderAt - firstSampleNanos);
                completion.complete(firstSampleNanos);
            } catch (Throwable error) { completion.completeExceptionally(error); }
            finally { renderLock.unlock(); }
        });
        try { return completion.get(200, TimeUnit.MILLISECONDS); }
        catch (Exception error) { completion.cancel(false); throw error; }
    }

    /** Explicit diagnostics; forward-resync gaps are also visible as padded PCM frames. */
    public java.util.Map<String, Object> timingStats() {
        java.util.Map<String, Object> stats = new java.util.LinkedHashMap<>();
        stats.put("clockResyncs", clockResyncs);
        stats.put("clockGapNanos", clockGapNanos);
        stats.put("maximumExecutorWaitNanos", maximumExecutorWaitNanos);
        stats.put("maximumTimestampLagNanos", maximumTimestampLagNanos);
        stats.put("maximumAllowedTimestampLagNanos", BLOCK_NANOS);
        return stats;
    }

    private void releaseOutput() {
        if (outputContext != 0L) { alcDestroyContext(outputContext); outputContext = 0L; }
        if (outputDevice != 0L) { alcCloseDevice(outputDevice); outputDevice = 0L; }
    }

    private void releaseUntransferredGame() {
        if (!contextTransferred && gameContext != 0L) { alcDestroyContext(gameContext); gameContext = 0L; }
        if (!deviceTransferred && gameDevice != 0L) { alcCloseDevice(gameDevice); gameDevice = 0L; }
    }

    private void fail(String reason) {
        unavailable = reason;
        failed = true;
        AudioCapture.signalFailure(this, reason);
        LOG.log(System.Logger.Level.WARNING, reason);
    }

    private static void checkAl(String operation) {
        int error = alGetError();
        if (error != AL_NO_ERROR) throw new IllegalStateException(operation + ": OpenAL error " + error);
    }

    private static String describe(Throwable error) {
        String detail = error.getMessage();
        return error.getClass().getSimpleName() + (detail == null ? "" : ": " + detail);
    }
}
