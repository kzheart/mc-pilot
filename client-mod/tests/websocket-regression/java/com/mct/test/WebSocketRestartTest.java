package com.mct.test;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import com.mct.legacy.ActionRouter;
import com.mct.legacy.LegacyWebSocketServer;
import java.io.File;
import java.io.IOException;
import java.net.BindException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;

/** Relaunching the exact production servers on their fixed port after the server side closed live sockets. */
public final class WebSocketRestartTest {
    private static final Gson GSON = new Gson();
    private static final java.lang.reflect.Type PARAMS = new TypeToken<Map<String, Object>>() {}.getType();

    public static void main(String[] args) throws Exception {
        String variant = args[0];
        if (args.length > 1) { childServer(variant, Integer.parseInt(args[1])); return; }
        int port;
        try (ServerSocket reservation = new ServerSocket(0)) { port = reservation.getLocalPort(); }

        // A client JVM exits while CLI sockets are open; the kernel closes them from the
        // server side, leaving TIME_WAIT on the fixed port the relaunched client binds again.
        for (int round = 0; round < 3; round++) {
            Process child = spawnChild(variant, port);
            try {
                Peer peer = connect(port, "relaunched client JVM round " + round);
                peer.echo("process-" + round);
                assertLiveListenerExclusive(port);
                child.destroyForcibly().waitFor(5, TimeUnit.SECONDS);
                await(peer::isClosed, "killed JVM closes live socket");
            } finally {
                child.destroyForcibly().waitFor(5, TimeUnit.SECONDS);
            }
        }
        System.out.println("PASS " + variant + ": relaunched JVM rebinds its port after server-side close; live listener stays exclusive");
    }

    private static void start(String variant, int port) throws Exception {
        if (variant.equals("legacy")) {
            ActionRouter router = new ActionRouter();
            router.register((action, params) -> {
                try { return WebSocketRegressionHarness.execute(action, GSON.fromJson(params, PARAMS)); }
                catch (RuntimeException failure) { throw failure; }
                catch (Exception failure) { throw new RuntimeException(failure); }
            }, "test.");
            new LegacyWebSocketServer(port, router).start();
            return;
        }
        String mc = variant.equals("official") ? "Minecraft" : "MinecraftClient";
        Class<?> game = Class.forName("net.minecraft.client." + mc);
        Object server = Class.forName("com.mct.core.protocol.MctWebSocketServer")
            .getConstructor(int.class, game).newInstance(port, game.newInstance());
        server.getClass().getMethod("start").invoke(server);
    }

    private static void childServer(String variant, int port) throws Exception {
        start(variant, port);
        Thread.sleep(TimeUnit.MINUTES.toMillis(1));
    }

    private static Process spawnChild(String variant, int port) throws IOException {
        String java = System.getProperty("java.home") + File.separator + "bin" + File.separator + "java";
        return new ProcessBuilder(java, "-cp", System.getProperty("java.class.path"),
            WebSocketRestartTest.class.getName(), variant, String.valueOf(port)).inheritIO().start();
    }

    /** Address reuse must only cover TIME_WAIT, never a second listener on a live port. */
    private static void assertLiveListenerExclusive(int port) throws IOException {
        try (ServerSocket occupied = new ServerSocket()) {
            occupied.setReuseAddress(true);
            occupied.bind(new InetSocketAddress("127.0.0.1", port));
            throw new AssertionError("Address reuse took a live listener's port " + port);
        } catch (BindException expected) { }
    }

    private static Peer connect(int port, String detail) throws Exception {
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
        do {
            if (listening(port)) {
                Peer peer = new Peer(port);
                if (peer.connectBlocking(2, TimeUnit.SECONDS)) return peer;
                peer.close();
            }
            Thread.sleep(10);
        } while (System.nanoTime() < end);
        throw new AssertionError("No WebSocket server on port " + port + " after " + detail);
    }

    private static boolean listening(int port) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress("127.0.0.1", port), 30);
            return true;
        } catch (IOException closed) { return false; }
    }

    private static void await(BooleanSupplier condition, String detail) throws Exception {
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
        while (!condition.getAsBoolean()) {
            if (System.nanoTime() > end) throw new AssertionError(detail);
            Thread.sleep(5);
        }
    }

    private static final class Peer extends WebSocketClient {
        private final CountDownLatch reply = new CountDownLatch(1);
        Peer(int port) { super(URI.create("ws://127.0.0.1:" + port)); }
        void echo(String token) throws InterruptedException {
            send("{\"id\":\"echo\",\"action\":\"test.echo\",\"params\":{\"token\":\"" + token + "\"}}");
            if (!reply.await(2, TimeUnit.SECONDS)) throw new AssertionError("No echo reply for " + token);
        }
        @Override public void onOpen(ServerHandshake handshake) { }
        @Override public void onMessage(String message) {
            if (message.contains("\"success\":true")) reply.countDown();
        }
        @Override public void onClose(int code, String reason, boolean remote) { }
        @Override public void onError(Exception failure) { }
    }
}
