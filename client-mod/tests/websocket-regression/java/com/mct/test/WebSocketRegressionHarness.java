package com.mct.test;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import com.mct.core.concurrent.ClientTaskQueue;
import com.mct.legacy.ActionRouter;
import com.mct.legacy.LegacyWebSocketServer;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.lang.reflect.Field;
import java.net.ServerSocket;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** Exact transport/service/queue sources, a controllable fake game thread, and real TCP clients. */
public final class WebSocketRegressionHarness {
    private static final Gson GSON = new Gson();
    private static final java.lang.reflect.Type PARAMS = new TypeToken<Map<String, Object>>() {}.getType();
    private static final Map<String, CountDownLatch> GATES = new ConcurrentHashMap<>();
    private static final List<String> ACTIONS = Collections.synchronizedList(new ArrayList<String>());
    private static final List<String> EFFECTS = Collections.synchronizedList(new ArrayList<String>());
    private static final AtomicInteger EFFECT_INTERRUPTS = new AtomicInteger();
    private static volatile boolean paused;
    private static boolean legacyMode;

    private static CountDownLatch gate(String token) {
        CountDownLatch fresh = new CountDownLatch(1);
        CountDownLatch existing = GATES.putIfAbsent(token, fresh);
        return existing == null ? fresh : existing;
    }

    private static Map<String, Object> data(String key, Object value) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put(key, value);
        return result;
    }

    public static Map<String, Object> execute(String action, Map<String, Object> params) throws Exception {
        if (action.equals("test.recordingError")) {
            String message = "Requested 1920x1080 but the native framebuffer is 1280x720";
            if (legacyMode) throw new com.mct.legacy.LegacyActionException("RECORDING_FRAMEBUFFER_MISMATCH", message);
            throw new com.mct.core.util.ActionException("RECORDING_FRAMEBUFFER_MISMATCH", message);
        }
        if (action.equals("test.normalError")) {
            if (legacyMode) throw new com.mct.legacy.LegacyActionException("NOT_IN_WORLD", "must stay private");
            throw new com.mct.core.util.ActionException("NOT_IN_WORLD", "must stay private");
        }
        String token = params.containsKey("token") ? String.valueOf(params.get("token")) : action;
        ACTIONS.add(token);
        System.out.println("ACTION " + token);
        if (action.equals("test.block")) {
            try {
                if (!gate(token).await(5, TimeUnit.SECONDS)) throw new IllegalStateException("Gate never released: " + token);
            } catch (InterruptedException interrupted) {
                System.out.println("INTERRUPTED " + token);
                throw interrupted;
            }
            return data("token", token);
        }
        if (action.equals("test.effect") || action.equals("test.startedEffect")) {
            final boolean blockEffect = action.equals("test.startedEffect");
            return ClientTaskQueue.getInstance().call(() -> {
                System.out.println("EFFECT_STARTED " + token);
                if (blockEffect) {
                    try {
                        if (!gate(token).await(5, TimeUnit.SECONDS)) throw new IllegalStateException("Effect gate never released");
                    } catch (InterruptedException interrupted) {
                        EFFECT_INTERRUPTS.incrementAndGet();
                        throw interrupted;
                    }
                }
                EFFECTS.add(token);
                System.out.println("EFFECT_COMPLETE " + token);
                return data("token", token);
            }, 5_000L);
        }
        if (action.equals("test.large")) {
            char[] value = new char[100_000];
            Arrays.fill(value, 'x');
            return data("payload", new String(value));
        }
        if (action.equals("test.status")) {
            Map<String, Object> result = new LinkedHashMap<>();
            synchronized (ACTIONS) { result.put("actions", new ArrayList<>(ACTIONS)); }
            synchronized (EFFECTS) { result.put("effects", new ArrayList<>(EFFECTS)); }
            result.put("effectInterrupts", EFFECT_INTERRUPTS.get());
            return result;
        }
        if (action.equals("test.echo")) return data("token", token);
        throw new IllegalArgumentException("Unknown test action: " + action);
    }

    public static void main(String[] args) throws Exception {
        int port;
        try (ServerSocket reservation = new ServerSocket(0)) { port = reservation.getLocalPort(); }
        final Object server;
        final boolean legacy = args[0].equals("legacy");
        legacyMode = legacy;
        if (legacy) {
            ActionRouter router = new ActionRouter();
            router.register((action, params) -> {
                try { return execute(action, GSON.fromJson(params, PARAMS)); }
                catch (RuntimeException failure) { throw failure; }
                catch (Exception failure) { throw new RuntimeException(failure); }
            }, "test.");
            server = new LegacyWebSocketServer(port, router);
        } else {
            String mc = args[0].equals("official") ? "Minecraft" : "MinecraftClient";
            Class<?> gameType = Class.forName("net.minecraft.client." + mc);
            server = Class.forName("com.mct.core.protocol.MctWebSocketServer")
                .getConstructor(int.class, gameType).newInstance(port, gameType.newInstance());
        }
        // Accelerate the compatibility-only default queue budget. No source rewrites:
        // an old request blocked for >120ms must survive an 80ms queue-only budget.
        Field requests = server.getClass().getDeclaredField("requests");
        requests.setAccessible(true);
        Object service = requests.get(server);
        Field defaultBudget = service.getClass().getDeclaredField("defaultQueueTimeoutMillis");
        defaultBudget.setAccessible(true);
        defaultBudget.setLong(service, 80L);
        server.getClass().getMethod("start").invoke(server);
        ScheduledExecutorService tick = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread thread = new Thread(r, "fake-minecraft-main");
            thread.setDaemon(true);
            return thread;
        });
        tick.scheduleWithFixedDelay(() -> { if (!paused) ClientTaskQueue.getInstance().drain(); }, 0, 2, TimeUnit.MILLISECONDS);
        System.out.println("READY " + port);
        try {
            BufferedReader input = new BufferedReader(new InputStreamReader(System.in));
            for (String command; (command = input.readLine()) != null;) {
                if (command.startsWith("RELEASE ")) gate(command.substring(8)).countDown();
                else if (command.equals("PAUSE")) { paused = true; System.out.println("PAUSED"); }
                else if (command.equals("RESUME")) { paused = false; System.out.println("RESUMED"); }
                else if (command.equals("STOP")) break;
                else if (command.startsWith("PENDING ")) {
                    java.lang.reflect.Method pending = ClientTaskQueue.class.getDeclaredMethod("pendingTasks");
                    pending.setAccessible(true);
                    System.out.println("PENDING " + command.substring(8) + " " + pending.invoke(ClientTaskQueue.getInstance()));
                }
            }
        } finally {
            if (legacy) ((LegacyWebSocketServer) server).shutdown();
            else server.getClass().getMethod("stop", int.class, String.class).invoke(server, 500, "test shutdown");
            for (CountDownLatch latch : GATES.values()) latch.countDown();
            tick.shutdown();
            tick.awaitTermination(1, TimeUnit.SECONDS);
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(1);
            List<String> remaining;
            do {
                remaining = new ArrayList<>();
                for (Thread thread : Thread.getAllStackTraces().keySet()) {
                    String name = thread.getName();
                    if (thread.isAlive() && (name.startsWith("mcpilot-ws-dispatch-") || name.startsWith("mct-forge-1.12-"))) remaining.add(name);
                }
                if (remaining.isEmpty()) break;
                Thread.sleep(5);
            } while (System.nanoTime() < deadline);
            System.out.println("STOPPED " + GSON.toJson(remaining));
            if (!remaining.isEmpty()) throw new AssertionError("Leaked server threads: " + remaining);
        }
    }
}
