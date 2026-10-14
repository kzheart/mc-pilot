package com.mct.core.concurrent;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

public final class TemporaryInputLeasesTest {
    private static int passed;

    private static final class Key {
        boolean held;
        final List<Boolean> writes = new ArrayList<>();
        Key() {}
        Key(boolean held) { this.held = held; }
        void write(boolean value) { held = value; writes.add(value); }
    }

    public static void main(String[] args) throws Exception {
        interruptedWorkerAndPausedTicks();
        partialAcquireAndFailedPress();
        closeRacesStartedPress();
        closedBeforePressAndDuringRead();
        overlappingOwnersAndAliases();
        persistentIntentDuringHold();
        persistentInitialStateAndNoRetention();
        boundedCapacityAndIdempotence();
        cleanupFailureRetriesWithoutBlockingOthers();
        failedCleanupOverlappingNewOwner();
        explicitIntentSupersedesFailedCleanup();
        rejectForeignScope();
        shutdownClosesAllWithoutWorkerWrites();
        aliasesWithDifferentWritersAndPersistentIntent();
        concurrentScopeReservationIsBounded();
        consecutiveScopesAfterNormalDrainEmitSeparatePresses();
        originalWriterPairsAllPhysicalEffects();
        System.out.println("PASS TemporaryInputLeasesTest: " + passed + " cases");
    }

    private static void interruptedWorkerAndPausedTicks() throws Exception {
        TemporaryInputLeases leases = new TemporaryInputLeases(2, 2);
        TemporaryInputLeases.Scope scope = leases.openScope();
        Key key = new Key();
        leases.acquire(scope, "forward", () -> key.held, key::write);
        AtomicBoolean interruptPreserved = new AtomicBoolean();
        Thread worker = new Thread(() -> {
            Thread.currentThread().interrupt();
            scope.close();
            interruptPreserved.set(Thread.currentThread().isInterrupted());
        });
        worker.start();
        worker.join(1000);
        check(!worker.isAlive(), "close must not wait for game ticks");
        check(interruptPreserved.get(), "close must preserve interruption");
        check(key.held, "paused ticks retain cleanup rather than running off-thread");
        equal(leases.retainedScopes(), 1, "closed scope retained until tick");
        leases.drainClosed();
        check(!key.held, "next tick releases canceled hold");
        empty(leases);
        passed++;
    }

    private static void partialAcquireAndFailedPress() {
        TemporaryInputLeases leases = new TemporaryInputLeases(2, 3);
        TemporaryInputLeases.Scope scope = leases.openScope();
        Key first = new Key(), partial = new Key();
        boolean thrown = false;
        try {
            leases.acquire(scope, "first", () -> first.held, first::write);
            leases.acquire(scope, "partial", () -> partial.held, value -> {
                partial.write(value);
                if (value) throw new IllegalStateException("failure after physical press");
            });
        } catch (IllegalStateException expected) { thrown = true; }
        finally { scope.close(); }
        check(thrown && first.held && partial.held, "partial acquisition retains both owners");
        leases.drainClosed();
        check(!first.held && !partial.held, "cleanup includes press that threw after changing state");
        empty(leases);
        passed++;
    }

    private static void closeRacesStartedPress() throws Exception {
        TemporaryInputLeases leases = new TemporaryInputLeases(1, 1);
        TemporaryInputLeases.Scope scope = leases.openScope();
        Key key = new Key();
        CountDownLatch entered = new CountDownLatch(1), closed = new CountDownLatch(1);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        Thread worker = new Thread(() -> {
            try {
                await(entered);
                scope.close();
                closed.countDown();
            } catch (Throwable error) { failure.set(error); }
        });
        worker.start();
        leases.acquire(scope, key, () -> key.held, value -> {
            key.write(value);
            if (value) { entered.countDown(); await(closed); }
        });
        worker.join(1000);
        check(failure.get() == null && !worker.isAlive(), "deterministic close/press race completed");
        check(key.held && scope.isClosed(), "press was already running at close");
        leases.drainClosed();
        check(!key.held, "registered ownership survives canceled press acknowledgement");
        empty(leases);
        passed++;
    }

    private static void closedBeforePressAndDuringRead() {
        TemporaryInputLeases leases = new TemporaryInputLeases(2, 2);
        TemporaryInputLeases.Scope before = leases.openScope();
        before.close();
        AtomicInteger calls = new AtomicInteger();
        check(!leases.acquire(before, "before", () -> { calls.incrementAndGet(); return false; }, value -> calls.incrementAndGet()), "closed acquisition rejected");
        TemporaryInputLeases.Scope during = leases.openScope();
        check(!leases.acquire(during, "during", () -> { during.close(); return false; }, value -> calls.incrementAndGet()), "close during initial read rejects write");
        equal(calls.get(), 0, "no read/write after known close and no press after read-close race");
        leases.drainClosed();
        empty(leases);
        passed++;
    }

    private static void overlappingOwnersAndAliases() {
        TemporaryInputLeases leases = new TemporaryInputLeases(2, 2);
        TemporaryInputLeases.Scope first = leases.openScope(), second = leases.openScope();
        Key key = new Key();
        leases.acquire(first, new String("key-87"), () -> key.held, key::write);
        leases.acquire(second, new String("key-87"), () -> { throw new AssertionError("baseline must be captured only once"); }, key::write);
        first.close();
        leases.drainClosed();
        check(key.held, "first owner cannot release second owner");
        equal(key.writes, Arrays.asList(true), "overlap does not replay press or release");
        second.close();
        leases.drainClosed();
        equal(key.writes, Arrays.asList(true, false), "last owner restores original baseline");
        empty(leases);
        passed++;
    }

    private static void persistentIntentDuringHold() {
        TemporaryInputLeases leases = new TemporaryInputLeases(2, 2);
        Key sneak = new Key();
        TemporaryInputLeases.Scope first = leases.openScope();
        leases.acquire(first, "sneak", () -> sneak.held, sneak::write);
        leases.persistent("sneak", true, sneak::write);
        first.close();
        leases.drainClosed();
        check(sneak.held, "new persistent sneak=true survives temporary release");
        equal(sneak.writes, Arrays.asList(true), "persistent hold does not emit a release");
        TemporaryInputLeases.Scope second = leases.openScope();
        leases.acquire(second, "sneak", () -> sneak.held, sneak::write);
        leases.persistent("sneak", false, sneak::write);
        check(sneak.held, "persistent up cannot release another temporary holder");
        second.close();
        leases.drainClosed();
        check(!sneak.held, "latest persistent up applies when last temporary owner exits");
        empty(leases);
        passed++;
    }

    private static void persistentInitialStateAndNoRetention() {
        TemporaryInputLeases leases = new TemporaryInputLeases(1, 1);
        Key sprint = new Key(true);
        TemporaryInputLeases.Scope scope = leases.openScope();
        leases.acquire(scope, "sprint", () -> sprint.held, sprint::write);
        scope.close();
        leases.drainClosed();
        check(sprint.held && sprint.writes.isEmpty(), "initial persistent state is untouched");
        leases.persistent("sprint", false, sprint::write);
        check(!sprint.held, "persistent write without leases is applied directly");
        empty(leases);
        passed++;
    }

    private static void boundedCapacityAndIdempotence() {
        TemporaryInputLeases leases = new TemporaryInputLeases(1, 2);
        TemporaryInputLeases.Scope scope = leases.openScope();
        rejects(leases::openScope);
        Key first = new Key(), second = new Key();
        leases.acquire(scope, "first", () -> first.held, first::write);
        leases.acquire(scope, "first", () -> { throw new AssertionError("duplicate read"); }, value -> { throw new AssertionError("duplicate write"); });
        leases.acquire(scope, "second", () -> second.held, second::write);
        rejects(() -> leases.acquire(scope, "overflow", () -> { throw new AssertionError("capacity read"); }, value -> { throw new AssertionError("capacity write"); }));
        scope.close(); scope.close();
        rejects(leases::openScope);
        leases.drainClosed(); leases.drainClosed();
        equal(first.writes, Arrays.asList(true, false), "idempotent ownership and cleanup");
        equal(second.writes, Arrays.asList(true, false), "all accepted controls cleaned");
        empty(leases);
        TemporaryInputLeases.Scope reused = leases.openScope();
        reused.close(); leases.drainClosed();
        empty(leases);
        passed++;
    }

    private static void cleanupFailureRetriesWithoutBlockingOthers() {
        TemporaryInputLeases leases = new TemporaryInputLeases(2, 2);
        TemporaryInputLeases.Scope badScope = leases.openScope(), goodScope = leases.openScope();
        Key bad = new Key(), good = new Key();
        AtomicInteger releases = new AtomicInteger();
        leases.acquire(badScope, "bad", () -> bad.held, value -> {
            if (!value && releases.incrementAndGet() < 3) throw new IllegalStateException("temporary cleanup failure");
            bad.write(value);
        });
        leases.acquire(goodScope, "good", () -> good.held, good::write);
        badScope.close(); goodScope.close();
        leases.drainClosed();
        check(bad.held && !good.held, "failed cleanup cannot block unrelated cleanup");
        equal(releases.get(), 1, "failed writer attempted once per tick");
        equal(leases.retainedScopes(), 1, "failed scope retained, successful scope reclaimed");
        leases.drainClosed();
        equal(releases.get(), 2, "next tick retries exactly once");
        equal(leases.cleanupFailureCount(), 2L, "explicit diagnostic counts bounded retry failures");
        leases.drainClosed();
        check(!bad.held, "later successful retry releases held input");
        empty(leases);
        passed++;
    }

    private static void failedCleanupOverlappingNewOwner() {
        TemporaryInputLeases leases = new TemporaryInputLeases(2, 1);
        TemporaryInputLeases.Scope first = leases.openScope();
        Key key = new Key();
        AtomicBoolean firstReleaseFails = new AtomicBoolean(true);
        leases.acquire(first, "shared", () -> key.held, value -> {
            if (!value && firstReleaseFails.getAndSet(false)) throw new IllegalStateException("release temporarily unavailable");
            key.write(value);
        });
        first.close(); leases.drainClosed();
        TemporaryInputLeases.Scope next = leases.openScope();
        leases.acquire(next, "shared", () -> { throw new AssertionError("must keep original baseline after failed release"); }, key::write);
        leases.drainClosed();
        check(key.held, "old failed cleanup cannot release newer holder");
        next.close(); leases.drainClosed();
        check(!key.held, "new owner's final release restores false, not stale held state");
        empty(leases);
        passed++;
    }

    private static void explicitIntentSupersedesFailedCleanup() {
        TemporaryInputLeases leases = new TemporaryInputLeases(1, 1);
        TemporaryInputLeases.Scope scope = leases.openScope();
        Key key = new Key();
        leases.acquire(scope, key, () -> key.held, value -> {
            if (!value) throw new IllegalStateException("release unavailable");
            key.write(value);
        });
        scope.close(); leases.drainClosed();
        leases.persistent(key, true, key::write);
        leases.drainClosed();
        check(key.held, "new persistent intent wins over retained failed release");
        empty(leases);
        passed++;
    }

    private static void rejectForeignScope() {
        TemporaryInputLeases first = new TemporaryInputLeases(1, 1), second = new TemporaryInputLeases(1, 1);
        TemporaryInputLeases.Scope scope = first.openScope();
        boolean rejected = false;
        try { second.acquire(scope, "key", () -> false, value -> {}); }
        catch (IllegalArgumentException expected) { rejected = true; }
        check(rejected, "foreign scopes must not bypass capacity accounting");
        scope.close(); first.drainClosed(); empty(first); empty(second);
        passed++;
    }

    private static void shutdownClosesAllWithoutWorkerWrites() throws Exception {
        TemporaryInputLeases leases = new TemporaryInputLeases(3, 1);
        TemporaryInputLeases.Scope first = leases.openScope(), second = leases.openScope(), empty = leases.openScope();
        Key firstKey = new Key(), secondKey = new Key();
        leases.acquire(first, "first", () -> firstKey.held, firstKey::write);
        leases.acquire(second, "second", () -> secondKey.held, secondKey::write);
        AtomicBoolean preserved = new AtomicBoolean();
        Thread shutdown = new Thread(() -> {
            Thread.currentThread().interrupt();
            leases.closeAll();
            preserved.set(Thread.currentThread().isInterrupted());
        });
        shutdown.start(); shutdown.join(1000);
        check(!shutdown.isAlive() && preserved.get(), "shutdown marking is bounded and preserves interrupt");
        check(first.isClosed() && second.isClosed() && empty.isClosed(), "shutdown marks all existing scopes");
        check(firstKey.held && secondKey.held, "shutdown never writes physical state off the game thread");
        leases.drainClosed();
        check(!firstKey.held && !secondKey.held, "final game tick releases all temporary holds");
        empty(leases);
        TemporaryInputLeases.Scope reopened = leases.openScope();
        reopened.close(); leases.drainClosed();
        empty(leases);
        passed++;
    }

    private static void aliasesWithDifferentWritersAndPersistentIntent() {
        TemporaryInputLeases leases = new TemporaryInputLeases(2, 1);
        TemporaryInputLeases.Scope movement = leases.openScope(), keyboard = leases.openScope();
        Key physical = new Key();
        List<String> writers = new ArrayList<>();
        Consumer<Boolean> movementWriter = held -> { writers.add("movement:" + held); physical.write(held); };
        Consumer<Boolean> keyboardWriter = held -> { writers.add("keyboard:" + held); physical.write(held); };
        Consumer<Boolean> persistentWriter = held -> { writers.add("persistent:" + held); physical.write(held); };
        // Adapter aliases "move.forward" and "input.w" resolve to this same physical key.
        leases.acquire(movement, new String("keyboard:87"), () -> physical.held, movementWriter);
        leases.acquire(keyboard, new String("keyboard:87"), () -> { throw new AssertionError("alias re-read baseline"); }, keyboardWriter);
        leases.persistent(new String("keyboard:87"), true, persistentWriter);
        movement.close(); leases.drainClosed();
        check(physical.held, "persistent down and other alias survive first owner's close");
        leases.persistent(new String("keyboard:87"), false, persistentWriter);
        check(physical.held, "persistent up cannot clear remaining alias owner");
        keyboard.close(); leases.drainClosed();
        check(!physical.held, "last owner's cleanup observes latest persistent up");
        equal(writers, Arrays.asList("movement:true", "movement:false"), "original writer pairs release while persistent intent selects final state");
        empty(leases);

        TemporaryInputLeases.Scope late = leases.openScope();
        leases.acquire(late, "keyboard:87", () -> physical.held, keyboardWriter);
        leases.persistent("keyboard:87", false, movementWriter);
        leases.persistent("keyboard:87", true, persistentWriter);
        late.close(); leases.drainClosed();
        check(physical.held, "latest persistent down wins after an earlier up from another writer");
        equal(writers, Arrays.asList("movement:true", "movement:false", "keyboard:true"), "cleanup never restores a stale false snapshot");
        empty(leases);
        passed++;
    }

    private static void concurrentScopeReservationIsBounded() throws Exception {
        TemporaryInputLeases leases = new TemporaryInputLeases(4, 1);
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger opened = new AtomicInteger(), rejected = new AtomicInteger();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        List<Thread> workers = new ArrayList<>();
        for (int index = 0; index < 8; index++) {
            Thread worker = new Thread(() -> {
                try {
                    await(start);
                    try { leases.openScope(); opened.incrementAndGet(); }
                    catch (RejectedExecutionException expected) { rejected.incrementAndGet(); }
                } catch (Throwable error) { failure.set(error); }
            });
            workers.add(worker); worker.start();
        }
        start.countDown();
        for (Thread worker : workers) { worker.join(1000); check(!worker.isAlive(), "scope reservation must not stall"); }
        check(failure.get() == null, "concurrent reservation succeeded");
        equal(opened.get(), 4, "concurrent reservations never exceed capacity");
        equal(rejected.get(), 4, "overflow rejected without allocating state");
        leases.closeAll(); leases.drainClosed(); empty(leases);
        passed++;
    }

    private static void consecutiveScopesAfterNormalDrainEmitSeparatePresses() {
        TemporaryInputLeases leases = new TemporaryInputLeases(1, 1);
        Key physical = new Key();
        for (int index = 0; index < 2; index++) {
            TemporaryInputLeases.Scope scope = leases.openScope();
            leases.acquire(scope, new String("same-key"), () -> physical.held, physical::write);
            scope.close();
            // Normal adapters synchronously drain cleanup before returning success.
            leases.drainClosed();
        }
        equal(physical.writes, Arrays.asList(true, false, true, false), "consecutive normal commands each get a paired press/release");
        empty(leases);
        passed++;
    }

    private static void originalWriterPairsAllPhysicalEffects() {
        TemporaryInputLeases leases = new TemporaryInputLeases(2, 1);
        TemporaryInputLeases.Scope mouse = leases.openScope(), alias = leases.openScope();
        Key binding = new Key();
        AtomicBoolean mouseHandlerDown = new AtomicBoolean();
        leases.acquire(mouse, "mouse:0", () -> binding.held, held -> {
            binding.write(held);
            mouseHandlerDown.set(held);
        });
        // Deliberately weaker alias writers must never replace the original pair.
        leases.acquire(alias, "mouse:0", () -> binding.held, binding::write);
        leases.persistent("mouse:0", false, binding::write);
        mouse.close(); leases.drainClosed();
        check(binding.held && mouseHandlerDown.get(), "remaining owner keeps every pressed subsystem held");
        alias.close(); leases.drainClosed();
        check(!binding.held && !mouseHandlerDown.get(), "original writer releases both binding and mouse-handler state");
        empty(leases);
        passed++;
    }

    private static void await(CountDownLatch latch) {
        try { check(latch.await(1, TimeUnit.SECONDS), "bounded latch wait timed out"); }
        catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new AssertionError(interrupted); }
    }
    private static void rejects(Runnable action) {
        boolean rejected = false;
        try { action.run(); } catch (RejectedExecutionException expected) { rejected = true; }
        check(rejected, "capacity must reject before mutation");
    }
    private static void empty(TemporaryInputLeases leases) {
        equal(leases.retainedScopes(), 0, "all scopes reclaimed");
        equal(leases.trackedControls(), 0, "all controls reclaimed");
    }
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private static void equal(Object actual, Object expected, String message) {
        if (!actual.equals(expected)) throw new AssertionError(message + ": expected " + expected + ", got " + actual);
    }
}
