package com.mct.core.recording;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.locks.LockSupport;

/** Bounded PCM copy queue, with all file I/O isolated on a daemon writer. */
final class PcmCapture {
    final AudioCapture.Provider provider;
    final Path path;
    private final RawFrameRecorder owner;
    private final long startNanos, maximumFrames;
    private final ArrayBlockingQueue<Block> queue = new ArrayBlockingQueue<Block>(AudioCapture.QUEUE_CAPACITY);
    private final Semaphore permits = new Semaphore(AudioCapture.QUEUE_CAPACITY);
    private final AtomicInteger producers = new AtomicInteger(), maxQueue = new AtomicInteger();
    private final CountDownLatch finished = new CountDownLatch(1);
    private final AtomicReference<String> error = new AtomicReference<String>();
    private final AtomicLong firstOffset = new AtomicLong(Long.MIN_VALUE);
    private final AtomicLong samples = new AtomicLong(), nonzero = new AtomicLong(), dropped = new AtomicLong();
    private final AtomicLong padded = new AtomicLong(), trimmed = new AtomicLong();
    private volatile long targetFrames = -1, writtenFrames;
    private volatile boolean accepting = true, aborted;
    private final Thread writer;
    private static final class Block {
        final byte[] bytes; final long firstFrame;
        Block(byte[] bytes, long firstFrame) { this.bytes = bytes; this.firstFrame = firstFrame; }
    }
    PcmCapture(RawFrameRecorder owner, AudioCapture.Provider provider, Path directory, long maximumNanos,
               RawFrameRecorder.WorkerFactory workers) throws IOException {
        this.owner = owner; this.provider = provider; startNanos = owner.getStartNanos();
        maximumFrames = framesForNanos(maximumNanos) + AudioCapture.SAMPLE_RATE;
        path = Files.createTempFile(directory, ".mct-game-audio-", ".pcm");
        try {
            writer = workers.create("mct-recording-pcm-writer", new Runnable() {
                @Override public void run() { write(); }
            });
        } catch (Throwable failure) {
            try { Files.deleteIfExists(path); } catch (IOException ignored) { }
            throw failure;
        }
    }
    void start() throws IOException {
        AudioCapture.attach(this);
        try { writer.start(); }
        catch (Throwable failure) { AudioCapture.detach(this); finished.countDown(); throw failure; }
    }
    static long framesForNanos(long nanos) {
        return Math.floorDiv(nanos, 1000000000L) * AudioCapture.SAMPLE_RATE +
                Math.floorDiv(Math.floorMod(nanos, 1000000000L) * AudioCapture.SAMPLE_RATE, 1000000000L);
    }
    boolean submit(byte[] pcm, int offset, int frames, long nanos) {
        if (pcm == null || offset < 0 || frames < 1 || frames > AudioCapture.MAX_BLOCK_FRAMES ||
                offset > pcm.length - frames * AudioCapture.BYTES_PER_FRAME) {
            fail("Invalid game audio PCM block; expected at most 9600 stereo s16le frames"); return false;
        }
        producers.incrementAndGet();
        try {
            if (!accepting || aborted) return false;
            long relative = nanos - startNanos;
            if (nanos - System.nanoTime() > TimeUnit.MILLISECONDS.toNanos(250) ||
                    relative > TimeUnit.SECONDS.toNanos(RawFrameRecorder.MAX_DURATION_SECONDS + 1L) ||
                    relative < -TimeUnit.SECONDS.toNanos(RawFrameRecorder.MAX_DURATION_SECONDS + 1L)) {
                fail("Game audio timestamp is outside the recording clock"); return false;
            }
            if (!permits.tryAcquire()) { dropped.addAndGet(frames); return false; }
            boolean offered = false;
            try {
                byte[] bytes = new byte[frames * AudioCapture.BYTES_PER_FRAME];
                System.arraycopy(pcm, offset, bytes, 0, bytes.length);
                long nonzeroFrames = 0;
                for (int i = 0; i < bytes.length; i += 4)
                    if ((bytes[i] | bytes[i+1] | bytes[i+2] | bytes[i+3]) != 0) nonzeroFrames++;
                offered = queue.offer(new Block(bytes, framesForNanos(relative)));
                if (!offered) { dropped.addAndGet(frames); return false; }
                firstOffset.compareAndSet(Long.MIN_VALUE, relative); samples.addAndGet(frames); nonzero.addAndGet(nonzeroFrames);
                int depth = queue.size(), previous;
                do { previous = maxQueue.get(); if (depth <= previous) break; }
                while (!maxQueue.compareAndSet(previous, depth));
                LockSupport.unpark(writer); return true;
            } finally { if (!offered) permits.release(); }
        } finally { producers.decrementAndGet(); LockSupport.unpark(writer); }
    }
    void freeze(long frames) {
        targetFrames = frames; accepting = false; AudioCapture.detach(this); LockSupport.unpark(writer);
    }
    void finish(long frames, long timeoutMillis) throws IOException, InterruptedException {
        freeze(frames);
        if (!finished.await(Math.max(1, timeoutMillis), TimeUnit.MILLISECONDS)) {
            abort(); throw new IOException("Game audio writer did not finalize before the recording deadline");
        }
        if (error.get() != null) throw new IOException(error.get());
        if (samples.get() == 0) {
            error.compareAndSet(null, "Requested game audio provider delivered no PCM sample frames"); throw new IOException(error.get());
        }
        if (writtenFrames != frames) throw new IOException("Game audio duration did not match the encoded video");
    }
    void fail(String message) {
        error.compareAndSet(null, message); owner.signalFailure("Game audio: " + message); abort();
    }
    void abort() {
        aborted = true; accepting = false; AudioCapture.detach(this); writer.interrupt(); LockSupport.unpark(writer);
    }
    void delete() { try { Files.deleteIfExists(path); } catch (IOException ignored) { } }
    private void write() {
        try (RandomAccessFile out = new RandomAccessFile(path.toFile(), "rw")) {
            byte[] silence = new byte[8192];
            while (!aborted) {
                Block block = queue.poll();
                if (block == null) {
                    if (!accepting && producers.get() == 0) break;
                    LockSupport.parkNanos(this, TimeUnit.MILLISECONDS.toNanos(10)); continue;
                }
                try {
                    long bound = targetFrames < 0 ? maximumFrames : targetFrames;
                    long begin = Math.max(0, block.firstFrame), end = Math.min(bound, block.firstFrame + block.bytes.length / 4);
                    if (end <= writtenFrames || end <= begin) { trimmed.addAndGet(block.bytes.length / 4); continue; }
                    pad(out, silence, Math.min(begin, end));
                    long offsetFrames = Math.max(writtenFrames, begin) - block.firstFrame;
                    int count = (int) (end - Math.max(writtenFrames, begin));
                    trimmed.addAndGet(block.bytes.length / 4 - count);
                    if (count > 0) { out.write(block.bytes, (int) offsetFrames * 4, count * 4); writtenFrames += count; }
                } finally { permits.release(); }
            }
            if (!aborted && targetFrames >= 0) {
                if (writtenFrames > targetFrames) {
                    trimmed.addAndGet(writtenFrames - targetFrames); out.setLength(targetFrames * 4); writtenFrames = targetFrames;
                }
                pad(out, silence, targetFrames);
            }
        } catch (Throwable failure) {
            if (!aborted) fail("PCM write failed: " + (failure.getMessage() == null ? failure.getClass().getSimpleName() : failure.getMessage()));
        } finally {
            Block block;
            while ((block = queue.poll()) != null) { dropped.addAndGet(block.bytes.length / 4); permits.release(); }
            finished.countDown();
        }
    }
    private void pad(RandomAccessFile out, byte[] silence, long end) throws IOException {
        while (writtenFrames < end) {
            if (aborted) throw new IOException("PCM capture aborted");
            int count = (int) Math.min(silence.length / 4, end - writtenFrames);
            out.write(silence, 0, count * 4); writtenFrames += count; padded.addAndGet(count);
        }
    }
    Map<String, Object> snapshot(boolean finalized) {
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        m.put("requested", true); m.put("enabled", true); m.put("trackPresent", finalized);
        m.put("source", provider.name()); m.put("sampleRate", AudioCapture.SAMPLE_RATE); m.put("channels", AudioCapture.CHANNELS);
        m.put("format", "s16le"); m.put("codec", "aac"); m.put("sampleFrames", samples.get()); m.put("nonzeroSampleFrames", nonzero.get());
        m.put("droppedSampleFrames", dropped.get()); m.put("paddedSampleFrames", padded.get()); m.put("trimmedSampleFrames", trimmed.get());
        m.put("outputSampleFrames", writtenFrames); m.put("queueDepth", queue.size()); m.put("maxQueueDepth", maxQueue.get());
        m.put("queueCapacity", AudioCapture.QUEUE_CAPACITY);
        m.put("firstSampleOffsetSeconds", firstOffset.get() == Long.MIN_VALUE ? null : firstOffset.get() / 1e9);
        m.put("error", error.get()); return m;
    }
}
