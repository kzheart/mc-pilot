package com.mct.core.concurrent;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/** No Minecraft, WebSocket, or test-library dependency; also runs on Java 8. */
public final class ClientTaskQueueTest {
    private static int checks;

    public static void main(String[] args) throws Exception {
        originalDropQueueLosesFuture();
        mailboxSurvivesDisconnect();
        timeoutCancelsPendingTask();
        interruptCancelsPendingTask();
        exceptionPropagates();
        repeatedAndNestedDrainsRunOnce();
        fifoAndTaskBudget();
        slowFrameBudget();
        expiredDeadlineIsSkipped();
        saturationRejectsWithoutRunning();
        preInterruptedCallIsNotQueued();
        System.out.println("ClientTaskQueueTest: " + checks + " checks passed");
    }

    private static ClientTaskQueue queue() {
        return new ClientTaskQueue(16, 64, TimeUnit.SECONDS.toNanos(1), System::nanoTime);
    }

    private static void originalDropQueueLosesFuture() {
        Queue<Runnable> minecraftTasks = new ConcurrentLinkedQueue<>();
        CompletableFuture<String> first = new CompletableFuture<>();
        CompletableFuture<String> second = new CompletableFuture<>();
        minecraftTasks.add(() -> { minecraftTasks.clear(); first.complete("first"); });
        minecraftTasks.add(() -> second.complete("second"));
        minecraftTasks.remove().run();
        check(first.isDone(), "original first reconnect completes");
        check(minecraftTasks.isEmpty() && !second.isDone() && !second.isCancelled(),
            "red proof: disconnect clears the second callback but leaves its future pending");
    }

    private static void mailboxSurvivesDisconnect() throws Exception {
        ClientTaskQueue queue = queue();
        Queue<Runnable> minecraftTasks = new ConcurrentLinkedQueue<>();
        minecraftTasks.add(() -> { throw new AssertionError("discarded native task ran"); });
        Call<String> first = start(queue, () -> { minecraftTasks.clear(); return "reconnect"; }, 1);
        Call<String> second = start(queue, () -> "status", 2);
        queue.drain();
        first.join(); second.join();
        eq("reconnect", first.result, "reconnect callback completes");
        eq("status", second.result, "adjacent status survives native queue clear");
        check(first.failure == null && second.failure == null, "both callers receive normal responses");
    }

    private static void timeoutCancelsPendingTask() throws Exception {
        ClientTaskQueue queue = queue();
        AtomicInteger effects = new AtomicInteger();
        Call<Integer> call = new Call<>(queue, effects::incrementAndGet, 40);
        call.start(); call.join();
        check(call.failure instanceof TimeoutException, "pending caller times out");
        eq(0, queue.pendingTasks(), "timed-out task removed");
        queue.drain();
        eq(0, effects.get(), "timed-out pending task never executes later");
    }

    private static void interruptCancelsPendingTask() throws Exception {
        ClientTaskQueue queue = queue();
        AtomicInteger effects = new AtomicInteger();
        Call<Integer> call = start(queue, effects::incrementAndGet, 1);
        call.thread.interrupt(); call.join();
        check(call.failure instanceof InterruptedException, "waiting interruption propagates");
        eq(0, queue.pendingTasks(), "interrupted task removed");
        queue.drain();
        eq(0, effects.get(), "interrupted pending task never executes later");
    }

    private static void exceptionPropagates() throws Exception {
        ClientTaskQueue queue = queue();
        IllegalStateException expected = new IllegalStateException("test action failure");
        Call<Object> call = start(queue, () -> { throw expected; }, 1);
        queue.drain(); call.join();
        check(call.failure instanceof ExecutionException && call.failure.getCause() == expected,
            "original action exception retained as ExecutionException cause");
    }

    private static void repeatedAndNestedDrainsRunOnce() throws Exception {
        ClientTaskQueue queue = queue();
        AtomicInteger effects = new AtomicInteger();
        List<String> order = new ArrayList<>();
        Call<Integer> first = start(queue, () -> {
            order.add("outer-start");
            queue.drain();
            int nested = queue.call(effects::incrementAndGet, 1000);
            order.add("outer-end");
            return nested;
        }, 1);
        Call<Integer> second = start(queue, () -> { order.add("second"); return effects.incrementAndGet(); }, 2);
        queue.drain(); queue.drain(); queue.drain();
        first.join(); second.join();
        eq(Arrays.asList("outer-start", "outer-end", "second"), order, "nested drain does not reenter the queue");
        eq(1, first.result, "nested main-thread call runs directly without deadlock");
        eq(2, second.result, "second callback runs once");
        eq(2, effects.get(), "repeated drain never duplicates an action");
    }

    private static void fifoAndTaskBudget() throws Exception {
        ClientTaskQueue queue = new ClientTaskQueue(8, 2, TimeUnit.SECONDS.toNanos(1), System::nanoTime);
        List<Integer> order = new ArrayList<>();
        Call<Integer> first = start(queue, () -> { order.add(1); return 1; }, 1);
        Call<Integer> second = start(queue, () -> { order.add(2); return 2; }, 2);
        Call<Integer> third = start(queue, () -> { order.add(3); return 3; }, 3);
        queue.drain();
        eq(Arrays.asList(1, 2), order, "drain respects FIFO and per-frame task budget");
        eq(1, queue.pendingTasks(), "excess work stays for the next frame");
        queue.drain(); first.join(); second.join(); third.join();
        eq(Arrays.asList(1, 2, 3), order, "next frame runs remaining work in FIFO order");
    }

    private static void slowFrameBudget() throws Exception {
        AtomicLong clock = new AtomicLong();
        ClientTaskQueue queue = new ClientTaskQueue(8, 64, 5, clock::get);
        AtomicInteger effects = new AtomicInteger();
        Call<Integer> first = start(queue, () -> { clock.addAndGet(5); return effects.incrementAndGet(); }, 1);
        Call<Integer> second = start(queue, effects::incrementAndGet, 2);
        queue.drain();
        eq(1, effects.get(), "slow action ends this frame's drain once time budget is used");
        eq(1, queue.pendingTasks(), "time budget does not discard next task");
        queue.drain(); first.join(); second.join();
        eq(2, effects.get(), "next frame resumes after slow action");
    }

    private static void expiredDeadlineIsSkipped() throws Exception {
        AtomicLong clock = new AtomicLong();
        ClientTaskQueue queue = new ClientTaskQueue(8, 64, 5, clock::get);
        AtomicInteger effects = new AtomicInteger();
        Call<Integer> call = start(queue, effects::incrementAndGet, 1);
        clock.addAndGet(TimeUnit.SECONDS.toNanos(10));
        queue.drain(); call.join();
        check(call.failure instanceof TimeoutException, "drain enforces expired deadline before invocation");
        eq(0, effects.get(), "expired task cannot start even before its waiter wakes");
    }

    private static void saturationRejectsWithoutRunning() throws Exception {
        ClientTaskQueue queue = new ClientTaskQueue(1, 1, 1, System::nanoTime);
        AtomicInteger effects = new AtomicInteger();
        Call<Integer> first = start(queue, effects::incrementAndGet, 1);
        try {
            queue.call(effects::incrementAndGet, 1000);
            throw new AssertionError("full queue accepted a task");
        } catch (ExecutionException expected) {
            check(expected.getCause() instanceof RejectedExecutionException, "full bounded queue rejects explicitly");
        }
        queue.drain(); first.join();
        eq(1, effects.get(), "rejected action never runs");
    }

    private static void preInterruptedCallIsNotQueued() throws Exception {
        ClientTaskQueue queue = queue();
        Thread.currentThread().interrupt();
        try {
            queue.call(() -> null, 1000);
            throw new AssertionError("interrupted caller was accepted");
        } catch (InterruptedException expected) {
            eq(0, queue.pendingTasks(), "pre-interrupted caller cannot enqueue an action");
        } finally {
            Thread.interrupted();
        }
    }

    private static <T> Call<T> start(ClientTaskQueue queue, Callable<T> operation, int expectedPending) throws Exception {
        Call<T> call = new Call<>(queue, operation, 5000);
        call.start();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        while (queue.pendingTasks() != expectedPending) {
            if (call.failure != null || System.nanoTime() >= deadline) {
                throw new AssertionError("caller did not enter mailbox: " + call.failure);
            }
            Thread.yield();
        }
        return call;
    }

    private static final class Call<T> {
        final Thread thread;
        volatile T result;
        volatile Throwable failure;

        Call(ClientTaskQueue queue, Callable<T> operation, long timeoutMillis) {
            thread = new Thread(() -> {
                try { result = queue.call(operation, timeoutMillis); }
                catch (Throwable exception) { failure = exception; }
            }, "test-websocket-caller");
            thread.setDaemon(true);
        }

        void start() { thread.start(); }
        void join() throws InterruptedException {
            thread.join(2000);
            if (thread.isAlive()) { throw new AssertionError("caller is stuck"); }
        }
    }

    private static void check(boolean ok, String label) {
        if (!ok) { throw new AssertionError(label); }
        checks++;
    }

    private static void eq(Object expected, Object actual, String label) {
        check(expected.equals(actual), label + ": expected " + expected + ", got " + actual);
    }
}
