package com.mct.core.concurrent;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

/** Standalone Java 8 regression tests; no Minecraft, WebSocket or test-library dependency. */
public final class ConnectionRequestDispatcherTest {
    private static int checks;

    public static void main(String[] args) throws Exception {
        fifoAndIndependentConnections();
        roundRobinFairness();
        boundedAdmission();
        globalReadyQueueAndPendingBounds();
        queuedDeadlineCancelsEffects();
        activeDeadlineInterruptsAndRepliesOnce();
        nonCooperativeTimeoutRetainsLaneOwnership();
        deadlineIncludesReceiptTimeAndNanoTimeWrap();
        oldClientQueueOnlyDeadlinePreservesHandlerWait();
        closeBeforeStartCancelsEffects();
        closeInterruptsClientTaskQueue();
        expiredWaitCancelsClientTaskQueue();
        startedMainThreadEffectIsResultUnknown();
        cancellationInterruptDoesNotLeak();
        exceptionsAndThrowingCallbacksAreContained();
        closeNeverWaitsForCallbackOrExternalMonitor();
        repeatedCloseAndShutdownCleanThreads();
        System.out.println("ConnectionRequestDispatcherTest: " + checks + " checks passed");
    }

    private static ConnectionRequestDispatcher<String> dispatcher(int workers, int connections, int pending) {
        return new ConnectionRequestDispatcher<>(workers, connections, connections, pending, 2, System::nanoTime);
    }

    private static void fifoAndIndependentConnections() throws Exception {
        ConnectionRequestDispatcher<String> dispatcher = dispatcher(2, 4, 4);
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        List<Integer> order = Collections.synchronizedList(new ArrayList<Integer>());
        try {
            check(dispatcher.open("a") && dispatcher.open("b"), "connections admitted");
            Result<Integer> first = new Result<>();
            submit(dispatcher, "a", 5000, () -> { started.countDown(); release.await(); order.add(1); return 1; }, first);
            await(started, "first action starts");
            Result<Integer> second = new Result<>();
            Result<Integer> third = new Result<>();
            submit(dispatcher, "a", 5000, () -> { order.add(2); return 2; }, second);
            submit(dispatcher, "a", 5000, () -> { order.add(3); return 3; }, third);
            Result<Integer> independent = new Result<>();
            submit(dispatcher, "b", 5000, () -> 9, independent);
            independent.await();
            eq(9, independent.value.get(), "another connection does not wait behind blocked lane");
            eq(0, second.responses.get(), "same connection cannot overtake active action");
            release.countDown(); first.await(); second.await(); third.await();
            eq(Arrays.asList(1, 2, 3), order, "accepted actions execute FIFO");
        } finally { release.countDown(); dispatcher.close(); }
    }

    private static void roundRobinFairness() throws Exception {
        ConnectionRequestDispatcher<String> dispatcher = dispatcher(1, 2, 4);
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        List<String> order = Collections.synchronizedList(new ArrayList<String>());
        try {
            dispatcher.open("a"); dispatcher.open("b");
            Result<Integer> first = new Result<>();
            submit(dispatcher, "a", 5000, () -> { started.countDown(); release.await(); order.add("a1"); return 1; }, first);
            await(started, "fairness first action starts");
            Result<Integer> a2 = new Result<>();
            Result<Integer> b1 = new Result<>();
            submit(dispatcher, "a", 5000, () -> { order.add("a2"); return 2; }, a2);
            submit(dispatcher, "b", 5000, () -> { order.add("b1"); return 3; }, b1);
            release.countDown(); first.await(); a2.await(); b1.await();
            eq(Arrays.asList("a1", "b1", "a2"), order, "busy lane yields worker after one action");
        } finally { release.countDown(); dispatcher.close(); }
    }

    private static void boundedAdmission() throws Exception {
        ConnectionRequestDispatcher<String> dispatcher = dispatcher(1, 2, 2);
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger effects = new AtomicInteger();
        try {
            check(dispatcher.open("a") && dispatcher.open("b"), "connection bound permits exact limit");
            check(!dispatcher.open("c"), "global connection bound rejects excess");
            check(dispatcher.open("a"), "opening existing connection is idempotent");
            Result<Integer> active = new Result<>();
            submit(dispatcher, "a", 5000, () -> { started.countDown(); release.await(); return 0; }, active);
            await(started, "saturation active job starts");
            Result<Integer> one = new Result<>(); Result<Integer> two = new Result<>();
            submit(dispatcher, "a", 5000, effects::incrementAndGet, one);
            submit(dispatcher, "a", 5000, effects::incrementAndGet, two);
            Result<Integer> rejected = new Result<>();
            check(!dispatcher.submit("a", 5000, effects::incrementAndGet, rejected::success, rejected::failure), "lane bound rejects excess");
            eq(1, rejected.responses.get(), "BUSY rejection is immediate");
            failure(rejected, ConnectionRequestDispatcher.FailureCode.BUSY, false);
            Result<Integer> unknown = new Result<>();
            check(!dispatcher.submit("missing", 5000, effects::incrementAndGet, unknown::success, unknown::failure), "unknown connection rejected");
            eq(0, unknown.responses.get(), "unknown connection has no response");
            release.countDown(); active.await(); one.await(); two.await();
            eq(2, effects.get(), "only admitted queued actions execute");
            dispatcher.closeConnection("b");
            check(dispatcher.open("c"), "close frees bounded connection slot");
        } finally { release.countDown(); dispatcher.close(); }
    }

    private static void globalReadyQueueAndPendingBounds() throws Exception {
        ConnectionRequestDispatcher<String> dispatcher = new ConnectionRequestDispatcher<>();
        CountDownLatch started = new CountDownLatch(4);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger effects = new AtomicInteger();
        Result<Integer> cancelled = new Result<>();
        try {
            // Hold all four workers with closed, non-cooperative old connections.
            // New lanes can then fill the entire 64-entry ready queue at once.
            for (int i = 0; i < 4; i++) {
                String key = "old" + i;
                dispatcher.open(key);
                submit(dispatcher, key, 5000, () -> {
                    started.countDown();
                    boolean waiting = true;
                    while (waiting) {
                        try { release.await(); waiting = false; }
                        catch (InterruptedException ignored) { /* await test release */ }
                    }
                    return 0;
                }, cancelled);
            }
            await(started, "all four bounded workers are occupied");
            for (int i = 0; i < 4; i++) dispatcher.closeConnection("old" + i);
            for (int i = 0; i < 64; i++) {
                String key = "new" + i;
                check(dispatcher.open(key), "all 64 ready lanes admitted");
                for (int j = 0; j < 16; j++) {
                    submit(dispatcher, key, 5000, effects::incrementAndGet, cancelled);
                }
                Result<Integer> rejected = new Result<>();
                check(!dispatcher.submit(key, 5000, effects::incrementAndGet,
                    rejected::success, rejected::failure), "seventeenth pending job is rejected");
                eq(1, rejected.responses.get(), "full default lane rejects synchronously");
                failure(rejected, ConnectionRequestDispatcher.FailureCode.BUSY, false);
            }
            check(!dispatcher.open("overflow"), "full global ready-lane capacity rejects another connection");
            dispatcher.close();
            release.countDown();
            until(() -> dispatcherThreads() == 0, "shutdown cancels full ready queue and all pending work");
            eq(0, effects.get(), "1024 cancelled pending jobs cause no side effects");
            eq(0, cancelled.responses.get(), "closed active and queued jobs send no callbacks");
        } finally { release.countDown(); dispatcher.close(); }
    }

    private static void queuedDeadlineCancelsEffects() throws Exception {
        ConnectionRequestDispatcher<String> dispatcher = dispatcher(1, 2, 3);
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger effects = new AtomicInteger();
        try {
            dispatcher.open("a"); dispatcher.open("b");
            Result<Integer> active = new Result<>();
            submit(dispatcher, "a", 5000, () -> { started.countDown(); release.await(); return 0; }, active);
            await(started, "queue-deadline blocker starts");
            Result<Integer> sameLane = new Result<>();
            Result<Integer> otherLane = new Result<>();
            submit(dispatcher, "a", 40, effects::incrementAndGet, sameLane);
            submit(dispatcher, "b", 40, effects::incrementAndGet, otherLane);
            sameLane.await(); otherLane.await();
            failure(sameLane, ConnectionRequestDispatcher.FailureCode.TIMEOUT, false);
            failure(otherLane, ConnectionRequestDispatcher.FailureCode.TIMEOUT, false);
            release.countDown(); active.await();
            Result<Integer> barrier = new Result<>();
            submit(dispatcher, "b", 5000, () -> 1, barrier); barrier.await();
            eq(0, effects.get(), "expired queued work never executes when worker becomes free");
            eq(1, sameLane.responses.get(), "queued expiry replies exactly once");
        } finally { release.countDown(); dispatcher.close(); }
    }

    private static void activeDeadlineInterruptsAndRepliesOnce() throws Exception {
        ConnectionRequestDispatcher<String> dispatcher = dispatcher(1, 1, 2);
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch interrupted = new CountDownLatch(1);
        try {
            dispatcher.open("a");
            Result<Integer> result = new Result<>();
            submit(dispatcher, "a", 60, () -> {
                started.countDown();
                try { new CountDownLatch(1).await(); }
                catch (InterruptedException expected) { interrupted.countDown(); }
                return 99;
            }, result);
            await(started, "active deadline action starts"); result.await();
            await(interrupted, "deadline interrupts active wait");
            failure(result, ConnectionRequestDispatcher.FailureCode.TIMEOUT, true);
            Result<Integer> barrier = new Result<>();
            submit(dispatcher, "a", 5000, () -> 1, barrier); barrier.await();
            eq(1, result.responses.get(), "late action return cannot send a second success");
            check(result.value.get() == null, "timed-out response has no late success payload");
        } finally { dispatcher.close(); }
    }

    private static void nonCooperativeTimeoutRetainsLaneOwnership() throws Exception {
        ConnectionRequestDispatcher<String> dispatcher = dispatcher(2, 2, 3);
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger effects = new AtomicInteger();
        try {
            dispatcher.open("a"); dispatcher.open("b");
            Result<Integer> first = new Result<>();
            submit(dispatcher, "a", 60, () -> {
                started.countDown();
                boolean waiting = true;
                while (waiting) {
                    try { release.await(); waiting = false; }
                    catch (InterruptedException ignored) { /* simulate uninterruptible operation */ }
                }
                return 1;
            }, first);
            await(started, "uncooperative action starts"); first.await();
            failure(first, ConnectionRequestDispatcher.FailureCode.TIMEOUT, true);
            Result<Integer> queued = new Result<>();
            submit(dispatcher, "a", 30, effects::incrementAndGet, queued);
            Result<Boolean> independent = new Result<>();
            submit(dispatcher, "b", 5000, () -> Thread.currentThread().isInterrupted(), independent);
            independent.await(); queued.await();
            eq(Boolean.FALSE, independent.value.get(), "other worker remains independent and un-interrupted");
            failure(queued, ConnectionRequestDispatcher.FailureCode.TIMEOUT, false);
            eq(0, effects.get(), "timeout never starts a second action while original still runs");
            release.countDown();
            Result<Boolean> reused = new Result<>();
            submit(dispatcher, "a", 5000, () -> Thread.currentThread().isInterrupted(), reused);
            reused.await();
            eq(Boolean.FALSE, reused.value.get(), "timed-out owner releases a clean worker");
            eq(1, first.responses.get(), "uncooperative late return emits no duplicate reply");
        } finally { release.countDown(); dispatcher.close(); }
    }

    private static void deadlineIncludesReceiptTimeAndNanoTimeWrap() throws Exception {
        AtomicLong time = new AtomicLong(Long.MIN_VALUE + 10000000L);
        ConnectionRequestDispatcher<String> dispatcher = new ConnectionRequestDispatcher<>(1, 1, 1, 2, 2, time::get);
        AtomicInteger effects = new AtomicInteger();
        try {
            dispatcher.open("a");
            Result<Integer> result = new Result<>();
            // Elapsed time is 20 ms even though nanoTime crossed signed long wrap.
            long received = Long.MAX_VALUE - 9999999L;
            check(dispatcher.submit("a", 10, received, true, effects::incrementAndGet,
                result::success, result::failure), "expired receipt can be admitted for timeout response");
            result.await(); failure(result, ConnectionRequestDispatcher.FailureCode.TIMEOUT, false);
            eq(0, effects.get(), "parsing/receipt budget is charged before execution");
        } finally { dispatcher.close(); }
    }

    private static void oldClientQueueOnlyDeadlinePreservesHandlerWait() throws Exception {
        ConnectionRequestDispatcher<String> dispatcher = dispatcher(1, 1, 3);
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger effects = new AtomicInteger();
        try {
            dispatcher.open("a");
            Result<Integer> active = new Result<>();
            check(dispatcher.submit("a", 30, System.nanoTime(), false,
                () -> { started.countDown(); release.await(); return 7; }, active::success, active::failure), "old client action admitted");
            await(started, "old client action begins");
            Result<Integer> queued = new Result<>();
            check(dispatcher.submit("a", 50, System.nanoTime(), false, effects::incrementAndGet,
                queued::success, queued::failure), "old client queued action admitted");
            queued.await(); failure(queued, ConnectionRequestDispatcher.FailureCode.TIMEOUT, false);
            eq(0, active.responses.get(), "queue-only deadline does not shorten executing old handler");
            release.countDown(); active.await();
            eq(7, active.value.get(), "old handler can finish after queue budget");
            eq(0, effects.get(), "old client queue expiry still prevents stale execution");
        } finally { release.countDown(); dispatcher.close(); }
    }

    private static void closeBeforeStartCancelsEffects() throws Exception {
        ConnectionRequestDispatcher<String> dispatcher = dispatcher(1, 2, 3);
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger effects = new AtomicInteger();
        try {
            dispatcher.open("a"); dispatcher.open("b");
            Result<Integer> active = new Result<>();
            submit(dispatcher, "a", 5000, () -> { started.countDown(); release.await(); return 0; }, active);
            await(started, "close-before-start blocker starts");
            Result<Integer> cancelled = new Result<>();
            submit(dispatcher, "b", 5000, effects::incrementAndGet, cancelled);
            dispatcher.closeConnection("b"); dispatcher.closeConnection("b");
            check(dispatcher.open("b"), "same key can open a fresh connection lane");
            Result<Integer> newLane = new Result<>();
            submit(dispatcher, "b", 5000, () -> 3, newLane);
            release.countDown(); active.await(); newLane.await();
            eq(0, effects.get(), "close-before-start prevents side effects");
            eq(0, cancelled.responses.get(), "closed lane response suppressed");
        } finally { release.countDown(); dispatcher.close(); }
    }

    private static void closeInterruptsClientTaskQueue() throws Exception {
        ConnectionRequestDispatcher<String> dispatcher = dispatcher(1, 1, 2);
        ClientTaskQueue main = mainQueue();
        AtomicInteger effects = new AtomicInteger();
        try {
            dispatcher.open("a");
            Result<Integer> result = new Result<>();
            submit(dispatcher, "a", 5000, () -> main.call(effects::incrementAndGet, 5000), result);
            until(() -> main.pendingTasks() == 1, "main-thread FutureTask is pending");
            Result<Integer> queued = new Result<>();
            submit(dispatcher, "a", 5000, effects::incrementAndGet, queued);
            dispatcher.closeConnection("a");
            until(() -> main.pendingTasks() == 0, "connection close interrupts wait and removes main task");
            main.drain();
            eq(0, effects.get(), "closed connection cannot mutate game when tick resumes");
            eq(0, result.responses.get(), "close-active emits no error or success response");
            eq(0, queued.responses.get(), "close also suppresses later accepted work");
        } finally { dispatcher.close(); }
    }

    private static void expiredWaitCancelsClientTaskQueue() throws Exception {
        ConnectionRequestDispatcher<String> dispatcher = dispatcher(1, 1, 2);
        ClientTaskQueue main = mainQueue();
        AtomicInteger effects = new AtomicInteger();
        try {
            dispatcher.open("a");
            Result<Integer> result = new Result<>();
            submit(dispatcher, "a", 80, () -> main.call(effects::incrementAndGet, 5000), result);
            until(() -> main.pendingTasks() == 1, "deadline test reaches pending main task");
            result.await(); failure(result, ConnectionRequestDispatcher.FailureCode.TIMEOUT, true);
            until(() -> main.pendingTasks() == 0, "deadline interruption cancels pending FutureTask");
            main.drain(); eq(0, effects.get(), "deadline-expired task cannot mutate later");
        } finally { dispatcher.close(); }
    }

    private static void startedMainThreadEffectIsResultUnknown() throws Exception {
        ConnectionRequestDispatcher<String> dispatcher = dispatcher(1, 1, 2);
        ClientTaskQueue main = mainQueue();
        AtomicInteger effects = new AtomicInteger();
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        Thread client = null;
        try {
            dispatcher.open("a");
            Result<Integer> result = new Result<>();
            submit(dispatcher, "a", 120, () -> main.call(() -> {
                started.countDown(); release.await(); return effects.incrementAndGet();
            }, 5000), result);
            until(() -> main.pendingTasks() == 1, "game operation enqueued");
            client = new Thread(main::drain, "dispatcher-test-client-thread"); client.start();
            await(started, "game-thread effect starts"); result.await();
            failure(result, ConnectionRequestDispatcher.FailureCode.TIMEOUT, true);
            check(client.isAlive(), "timeout does not interrupt already-started game thread");
            release.countDown(); client.join(2000);
            eq(1, effects.get(), "already-started effect may finish after response timeout");
            eq(1, result.responses.get(), "unknown-result timeout remains sole response");
        } finally { release.countDown(); dispatcher.close(); if (client != null) client.join(2000); }
    }

    private static void cancellationInterruptDoesNotLeak() throws Exception {
        ConnectionRequestDispatcher<String> dispatcher = dispatcher(1, 1, 2);
        try {
            for (int i = 0; i < 100; i++) {
                check(dispatcher.open("a"), "stress lane opens");
                CountDownLatch started = new CountDownLatch(1);
                Result<Integer> old = new Result<>();
                submit(dispatcher, "a", 5000, () -> {
                    started.countDown();
                    try { new CountDownLatch(1).await(); }
                    catch (InterruptedException expected) { Thread.currentThread().interrupt(); }
                    return 1;
                }, old);
                await(started, "stress worker claims old lane");
                dispatcher.closeConnection("a");
                check(dispatcher.open("a"), "stress key reopens");
                Result<Boolean> fresh = new Result<>();
                submit(dispatcher, "a", 5000, () -> Thread.currentThread().isInterrupted(), fresh);
                fresh.await();
                eq(Boolean.FALSE, fresh.value.get(), "cancel interrupt cannot leak into reused worker");
                eq(0, old.responses.get(), "old lane stays silent after key reuse");
                dispatcher.closeConnection("a");
            }
        } finally { dispatcher.close(); }
    }

    private static void exceptionsAndThrowingCallbacksAreContained() throws Exception {
        ConnectionRequestDispatcher<String> dispatcher = dispatcher(1, 2, 3);
        try {
            dispatcher.open("a"); dispatcher.open("b");
            IllegalStateException cause = new IllegalStateException("original action cause");
            Result<Integer> result = new Result<>();
            submit(dispatcher, "a", 5000, () -> { throw cause; }, result);
            result.await(); failure(result, ConnectionRequestDispatcher.FailureCode.INTERNAL, true);
            check(result.error.get().getCause() == cause, "original action exception is preserved");
            CountDownLatch badSuccess = new CountDownLatch(1);
            check(dispatcher.submit("a", 5000, () -> 1,
                value -> { badSuccess.countDown(); throw new AssertionError("send failure"); }, ignored -> {}), "throwing callback admitted");
            await(badSuccess, "throwing success callback ran");
            Result<Integer> next = new Result<>();
            submit(dispatcher, "a", 5000, () -> 2, next); next.await();
            eq(2, next.value.get(), "bad success callback cannot kill worker");
            CountDownLatch badFailure = new CountDownLatch(1);
            check(dispatcher.submit("a", 20, () -> { new CountDownLatch(1).await(); return 1; },
                ignored -> {}, ignored -> { badFailure.countDown(); throw new AssertionError("send failure"); }), "throwing timeout callback admitted");
            await(badFailure, "throwing timeout callback ran");
            Result<Integer> deadline = new Result<>();
            submit(dispatcher, "b", 20, () -> { new CountDownLatch(1).await(); return 1; }, deadline);
            deadline.await(); failure(deadline, ConnectionRequestDispatcher.FailureCode.TIMEOUT, true);
        } finally { dispatcher.close(); }
    }

    private static void closeNeverWaitsForCallbackOrExternalMonitor() throws Exception {
        for (int mode = 0; mode < 2; mode++) {
            final boolean serverClose = mode == 1;
            ConnectionRequestDispatcher<String> dispatcher = dispatcher(1, 1, 2);
            Object transportMonitor = new Object();
            CountDownLatch callbackClaimed = new CountDownLatch(1);
            CountDownLatch callbackFinished = new CountDownLatch(1);
            CountDownLatch closeReturned = new CountDownLatch(1);
            AtomicReference<Throwable> thrown = new AtomicReference<>();
            dispatcher.open("a");
            // Models Java-WebSocket calling onClose while holding its own monitor,
            // as a response callback needs that same monitor for a transport call.
            Thread transport = new Thread(() -> {
                try {
                    synchronized (transportMonitor) {
                        dispatcher.submit("a", 5000, () -> 1, value -> {
                            callbackClaimed.countDown();
                            synchronized (transportMonitor) { callbackFinished.countDown(); }
                        }, failure -> {});
                        if (!callbackClaimed.await(3, TimeUnit.SECONDS)) {
                            throw new AssertionError("callback did not start");
                        }
                        if (serverClose) dispatcher.close();
                        else dispatcher.closeConnection("a");
                        closeReturned.countDown();
                    }
                } catch (Throwable failure) {
                    thrown.set(failure);
                    closeReturned.countDown();
                }
            }, "dispatcher-test-transport-monitor");
            transport.setDaemon(true);
            transport.start();
            // Do not call close in a failed regression: old implementations also
            // block there. All participating threads are daemon to fail cleanly.
            await(closeReturned, "close returns while callback waits on external transport monitor");
            check(thrown.get() == null, "external-monitor close has no failure");
            await(callbackFinished, "already-claimed callback may finish after nonblocking close");
            dispatcher.close();
            transport.join(2000);
        }
    }

    private static void repeatedCloseAndShutdownCleanThreads() throws Exception {
        until(() -> dispatcherThreads() == 0, "previous dispatchers terminate");
        ConnectionRequestDispatcher<String> dispatcher = new ConnectionRequestDispatcher<>();
        try {
            until(() -> dispatcherThreads() == 5, "default has exactly four workers and one watchdog");
            for (Map.Entry<Thread, StackTraceElement[]> entry : Thread.getAllStackTraces().entrySet()) {
                if (entry.getKey().getName().startsWith("mcpilot-ws-dispatch-")) {
                    check(entry.getKey().isDaemon(), "dispatcher thread is daemon");
                }
            }
            for (int i = 0; i < 64; i++) check(dispatcher.open("c" + i), "default admits 64 bounded lanes");
            check(!dispatcher.open("overflow"), "default refuses 65th lane");
            dispatcher.close(); dispatcher.close(); dispatcher.closeConnection("c0");
            check(!dispatcher.open("after-close"), "closed server refuses new lane");
            Result<Integer> rejected = new Result<>();
            check(!dispatcher.submit("c0", 100, () -> 1, rejected::success, rejected::failure), "closed server rejects request");
            eq(0, rejected.responses.get(), "shutdown suppresses responses");
            until(() -> dispatcherThreads() == 0, "shutdown reclaims every worker/watchdog thread");
        } finally { dispatcher.close(); }
    }

    private static int dispatcherThreads() {
        int count = 0;
        for (Thread thread : Thread.getAllStackTraces().keySet()) {
            if (thread.isAlive() && thread.getName().startsWith("mcpilot-ws-dispatch-")) count++;
        }
        return count;
    }

    private static ClientTaskQueue mainQueue() {
        return new ClientTaskQueue(16, 16, TimeUnit.SECONDS.toNanos(1), System::nanoTime);
    }

    private static <T> void submit(ConnectionRequestDispatcher<String> dispatcher, String key, long timeout,
                                    java.util.concurrent.Callable<T> action, Result<T> result) {
        check(dispatcher.submit(key, timeout, action, result::success, result::failure), "request admitted");
    }

    private static void failure(Result<?> result, ConnectionRequestDispatcher.FailureCode code, boolean started) {
        check(result.error.get() != null, "failure delivered");
        eq(code, result.error.get().getCode(), "failure code");
        eq(started, result.error.get().isStarted(), "failure execution status");
        eq(started, result.error.get().isResultUnknown(), "failure result uncertainty");
    }

    private static void await(CountDownLatch latch, String label) throws Exception {
        check(latch.await(3, TimeUnit.SECONDS), label);
    }

    private static void until(BooleanSupplier condition, String label) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
        while (!condition.getAsBoolean() && System.nanoTime() - deadline < 0) Thread.sleep(1);
        check(condition.getAsBoolean(), label);
    }

    private static void eq(Object expected, Object actual, String label) {
        check(expected == null ? actual == null : expected.equals(actual), label + ": expected " + expected + ", got " + actual);
    }

    private static void check(boolean condition, String label) {
        if (!condition) throw new AssertionError(label);
        checks++;
    }

    private static final class Result<T> {
        final CountDownLatch done = new CountDownLatch(1);
        final AtomicReference<T> value = new AtomicReference<>();
        final AtomicReference<ConnectionRequestDispatcher.Failure> error = new AtomicReference<>();
        final AtomicInteger responses = new AtomicInteger();
        void success(T result) { value.set(result); responses.incrementAndGet(); done.countDown(); }
        void failure(ConnectionRequestDispatcher.Failure failure) { error.set(failure); responses.incrementAndGet(); done.countDown(); }
        void await() throws Exception { ConnectionRequestDispatcherTest.await(done, "response arrives"); }
    }
}
