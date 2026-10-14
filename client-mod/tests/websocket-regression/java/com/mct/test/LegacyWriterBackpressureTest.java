package com.mct.test;

import com.mct.legacy.ActionRouter;
import com.mct.legacy.LegacyWebSocketServer;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.Socket;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;

/** Deterministic tests of the unchanged private writer, with no live socket or game. */
public final class LegacyWriterBackpressureTest {
    private static int checks;

    public static void main(String[] args) throws Exception {
        normalBurstAndFrameBound();
        byteBound();
        System.out.println("LegacyWriterBackpressureTest: " + checks + " checks passed");
    }

    private static void normalBurstAndFrameBound() throws Exception {
        try (Writer writer = new Writer()) {
            synchronized (writer.output) {
                writer.blockWrite();
                // One active action plus sixteen admitted pending actions can finish
                // before this writer is scheduled. A previous frame can still be in flight.
                for (int i = 0; i < 17; i++) writer.send(new byte[] {1});
                check(!writer.socket.isClosed(), "normal 17-response admission burst must not close the connection");
                check(writer.pending.size() == 17, "all normal burst frames remain queued");
                // Admission errors and control frames share this queue. Allow a small
                // bounded burst without dropping normal replies, but never grow forever.
                for (int i = 17; i < 64; i++) writer.send(new byte[] {1});
                check(!writer.socket.isClosed(), "64 queued response/control frames are permitted");
                check(writer.pending.size() == 64, "outgoing queue has an explicit 64-frame bound");
                writer.send(new byte[] {1});
                check(writer.socket.isClosed(), "the next frame closes a saturated connection");
                check(writer.pending.size() <= 64, "saturation cannot expand the queue");
            }
        }
    }

    private static void byteBound() throws Exception {
        try (Writer writer = new Writer()) {
            synchronized (writer.output) {
                writer.blockWrite();
                writer.send(new byte[4 * 1024 * 1024]);
                check(writer.socket.isClosed(), "the 4 MiB budget includes the blocked in-flight frame");
                check(writer.pending.isEmpty(), "an over-budget frame is never retained");
            }
        }
    }

    private static void check(boolean condition, String message) {
        checks++;
        if (!condition) throw new AssertionError(message);
    }

    private static final class MemorySocket extends Socket {
        private volatile boolean closed;
        @Override public boolean isClosed() { return closed; }
        @Override public void close() { closed = true; }
    }

    private static final class Writer implements AutoCloseable {
        final LegacyWebSocketServer server = new LegacyWebSocketServer(0, new ActionRouter());
        final MemorySocket socket = new MemorySocket();
        final BufferedOutputStream output = new BufferedOutputStream(new ByteArrayOutputStream());
        final Object connection;
        final Method send;
        final Thread thread;
        final BlockingQueue<?> pending;

        Writer() throws Exception {
            Class<?> type = Class.forName("com.mct.legacy.LegacyWebSocketServer$Connection");
            Constructor<?> constructor = type.getDeclaredConstructor(LegacyWebSocketServer.class, Socket.class, BufferedOutputStream.class);
            constructor.setAccessible(true);
            connection = constructor.newInstance(server, socket, output);
            send = type.getDeclaredMethod("send", int.class, byte[].class);
            send.setAccessible(true);
            Field threadField = type.getDeclaredField("thread");
            threadField.setAccessible(true);
            thread = (Thread) threadField.get(connection);
            Field pendingField = type.getDeclaredField("pending");
            pendingField.setAccessible(true);
            pending = (BlockingQueue<?>) pendingField.get(connection);
        }

        void send(byte[] payload) throws Exception { send.invoke(connection, 1, payload); }

        void blockWrite() throws Exception {
            // The caller owns the same output monitor as production writeFrame.
            // This pauses only our test-owned writer without sleeps in production
            // code, suspend(), timing assumptions, or changes to the transport.
            send(new byte[] {1});
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
            while (thread.getState() != Thread.State.BLOCKED && System.nanoTime() - deadline < 0) Thread.sleep(1);
            check(thread.getState() == Thread.State.BLOCKED && pending.isEmpty(), "writer is paused with exactly one in-flight frame");
        }

        @Override public void close() throws Exception {
            socket.close();
            thread.interrupt();
            server.shutdown();
            thread.join(2_000);
            check(!thread.isAlive(), "test-owned writer exits after the output monitor is released");
        }
    }
}
