package com.mct.core.concurrent;

import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

public final class AsyncResourceTest {
    private static int passed;

    private static final class Resource implements AutoCloseable {
        final AtomicInteger closes = new AtomicInteger();
        boolean failClose;
        @Override public void close() throws Exception {
            closes.incrementAndGet();
            if (failClose) throw new Exception("test partial native-resource close failure");
        }
    }

    public static void main(String[] args) throws Exception {
        interruptedWaitCleansLateResult();
        closeBeforeTrack();
        completionBeforeClose();
        normalClaimedOwnership();
        claimBeforeCompletionCallback();
        closeWinsClaimRace();
        trackCloseRace();
        claimCloseRace();
        exceptionalAndNullFutures();
        doubleCloseAndFailedDisposal();
        invalidClaimsAndSecondTrack();
        System.out.println("PASS AsyncResourceTest: " + passed + " cases");
    }

    private static void interruptedWaitCleansLateResult() throws Exception {
        AsyncResource<Resource> owner = new AsyncResource<>();
        CompletableFuture<Resource> future = owner.track(new CompletableFuture<Resource>());
        CountDownLatch waiting = new CountDownLatch(1);
        AtomicBoolean interrupted = new AtomicBoolean();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        Thread worker = new Thread(() -> {
            try (AsyncResource<Resource> cleanup = owner) {
                waiting.countDown();
                future.get();
                failure.set(new AssertionError("wait should have been interrupted"));
            } catch (InterruptedException expected) {
                Thread.currentThread().interrupt();
                owner.close();
                interrupted.set(Thread.currentThread().isInterrupted());
            } catch (Throwable unexpected) { failure.set(unexpected); }
        });
        worker.start(); await(waiting); worker.interrupt(); join(worker);
        check(interrupted.get() && failure.get() == null, "interrupted waiter exits without waiting for resource");
        check(!future.isCancelled(), "resource creation future remains observable after abandonment");
        Resource late = new Resource();
        future.complete(late);
        equal(late.closes.get(), 1, "late resource disposed exactly once");
        owner.close(); equal(late.closes.get(), 1, "second close does not repeat disposal");
        passed++;
    }

    private static void closeBeforeTrack() {
        AsyncResource<Resource> owner = new AsyncResource<>();
        owner.close();
        CompletableFuture<Resource> future = new CompletableFuture<>();
        check(owner.track(future) == future, "track returns original future");
        Resource result = new Resource(); future.complete(result);
        equal(result.closes.get(), 1, "already-started game task can register after close");
        AsyncResource<Resource> alreadyComplete = new AsyncResource<>();
        alreadyComplete.close();
        Resource ready = new Resource();
        alreadyComplete.track(CompletableFuture.completedFuture(ready));
        equal(ready.closes.get(), 1, "close-before-track also handles already-complete future");
        passed++;
    }

    private static void completionBeforeClose() {
        AsyncResource<Resource> owner = new AsyncResource<>();
        Resource result = new Resource();
        owner.track(CompletableFuture.completedFuture(result));
        equal(result.closes.get(), 0, "completed result remains owned until claim or abandonment");
        owner.close();
        equal(result.closes.get(), 1, "close disposes completed unclaimed result");
        passed++;
    }

    private static void normalClaimedOwnership() throws Exception {
        Resource result = new Resource();
        try (AsyncResource<Resource> owner = new AsyncResource<>()) {
            Resource claimed = owner.claim(owner.track(CompletableFuture.completedFuture(result)).get());
            check(claimed == result, "claim preserves resource identity");
            owner.close();
            equal(result.closes.get(), 0, "owner never disposes transferred ownership");
            claimed.close();
        }
        equal(result.closes.get(), 1, "normal caller closes exactly once");
        passed++;
    }

    private static void claimBeforeCompletionCallback() throws Exception {
        AsyncResource<Resource> owner = new AsyncResource<>();
        CompletableFuture<Resource> future = owner.track(new CompletableFuture<Resource>());
        CountDownLatch callbackEntered = new CountDownLatch(1), releaseCallback = new CountDownLatch(1);
        // CompletableFuture runs this newer dependent before the owner's callback.
        future.thenRun(() -> { callbackEntered.countDown(); await(releaseCallback); });
        Resource result = new Resource();
        Thread completing = new Thread(() -> future.complete(result));
        completing.start(); await(callbackEntered);
        check(owner.claim(future.get()) == result, "get can be claimed before owner's completion callback");
        owner.close(); releaseCallback.countDown(); join(completing);
        equal(result.closes.get(), 0, "late owner callback respects earlier ownership transfer");
        result.close(); equal(result.closes.get(), 1, "caller remains sole closer");
        passed++;
    }

    private static void closeWinsClaimRace() {
        AsyncResource<Resource> owner = new AsyncResource<>();
        Resource result = new Resource();
        owner.track(CompletableFuture.completedFuture(result)); owner.close();
        boolean canceled = false;
        try { owner.claim(result); } catch (CancellationException expected) { canceled = true; }
        check(canceled, "claim after abandonment fails instead of transferring a disposed image");
        equal(result.closes.get(), 1, "failed claim does not dispose twice");
        passed++;
    }

    private static void trackCloseRace() throws Exception {
        for (int index = 0; index < 100; index++) {
            AsyncResource<Resource> owner = new AsyncResource<>();
            Resource result = new Resource();
            CompletableFuture<Resource> future = CompletableFuture.completedFuture(result);
            CountDownLatch start = new CountDownLatch(1);
            AtomicReference<Throwable> failure = new AtomicReference<>();
            Thread tracking = new Thread(() -> {
                try { await(start); owner.track(future); } catch (Throwable error) { failure.set(error); }
            });
            tracking.start(); start.countDown(); owner.close(); join(tracking);
            check(failure.get() == null, "track/close racing is supported");
            equal(result.closes.get(), 1, "every track/close interleaving disposes once");
        }
        passed++;
    }

    private static void claimCloseRace() throws Exception {
        for (int index = 0; index < 100; index++) {
            AsyncResource<Resource> owner = new AsyncResource<>();
            Resource result = new Resource(); owner.track(CompletableFuture.completedFuture(result));
            CountDownLatch start = new CountDownLatch(1);
            AtomicBoolean claimed = new AtomicBoolean();
            AtomicReference<Throwable> failure = new AtomicReference<>();
            Thread claiming = new Thread(() -> {
                try { await(start); owner.claim(result); claimed.set(true); }
                catch (CancellationException expected) { /* abandoned owner won */ }
                catch (Throwable error) { failure.set(error); }
            });
            claiming.start(); start.countDown(); owner.close(); join(claiming);
            check(failure.get() == null, "claim/close race has only documented outcomes");
            if (claimed.get()) {
                equal(result.closes.get(), 0, "winning claim is never auto-closed");
                result.close();
            }
            equal(result.closes.get(), 1, "claim/close has exactly one eventual closer");
        }
        passed++;
    }

    private static void exceptionalAndNullFutures() {
        AsyncResource<Resource> exceptional = new AsyncResource<>();
        CompletableFuture<Resource> failed = exceptional.track(new CompletableFuture<Resource>());
        failed.completeExceptionally(new IllegalStateException("creation failed")); exceptional.close();
        AsyncResource<Resource> canceled = new AsyncResource<>();
        CompletableFuture<Resource> future = canceled.track(new CompletableFuture<Resource>());
        future.cancel(false); canceled.close();
        AsyncResource<Resource> empty = new AsyncResource<>();
        empty.track(CompletableFuture.completedFuture(null)); empty.close();
        check(failed.isCompletedExceptionally() && future.isCancelled(), "failure/cancellation state is unchanged");
        passed++;
    }

    private static void doubleCloseAndFailedDisposal() {
        Resource result = new Resource(); result.failClose = true;
        AsyncResource<Resource> owner = new AsyncResource<>(); owner.track(CompletableFuture.completedFuture(result));
        owner.close(); owner.close();
        equal(result.closes.get(), 1, "failed disposal is never retried or double-freed");
        passed++;
    }

    private static void invalidClaimsAndSecondTrack() throws Exception {
        AsyncResource<Resource> owner = new AsyncResource<>();
        Resource actual = new Resource(), unrelated = new Resource();
        CompletableFuture<Resource> future = owner.track(new CompletableFuture<Resource>());
        boolean notReady = false;
        try { owner.claim(actual); } catch (IllegalStateException expected) { notReady = true; }
        check(notReady, "unfinished future cannot transfer arbitrary ownership");
        future.complete(actual);
        boolean wrong = false;
        try { owner.claim(unrelated); } catch (IllegalArgumentException expected) { wrong = true; }
        check(wrong, "unrelated resource cannot suppress actual resource cleanup");
        boolean duplicate = false;
        try { owner.track(new CompletableFuture<Resource>()); } catch (IllegalStateException expected) { duplicate = true; }
        check(duplicate, "one future per owner is enforced");
        owner.claim(actual);
        boolean claimedTwice = false;
        try { owner.claim(actual); } catch (IllegalStateException expected) { claimedTwice = true; }
        check(claimedTwice, "ownership cannot be transferred twice");
        owner.close(); equal(actual.closes.get(), 0, "invalid operations did not steal caller ownership");
        actual.close(); equal(actual.closes.get(), 1, "normal claimed resource still closes once");
        equal(unrelated.closes.get(), 0, "owner never touches unrelated resource");
        passed++;
    }

    private static void await(CountDownLatch latch) {
        try { check(latch.await(2, TimeUnit.SECONDS), "bounded latch timed out"); }
        catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new AssertionError(interrupted); }
    }
    private static void join(Thread thread) throws InterruptedException {
        thread.join(2000); check(!thread.isAlive(), "test-owned thread did not finish");
    }
    private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
    private static void equal(int actual, int expected, String message) {
        if (actual != expected) throw new AssertionError(message + ": expected " + expected + ", got " + actual);
    }
}
