package com.mct.core.concurrent;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Bounded ownership for temporary game-thread input state.
 *
 * openScope/Scope.close may run on command workers. acquire, persistent and
 * drainClosed MUST run on the same game thread, including every state callback.
 * Closing only marks a scope: cleanup survives worker interruption, canceled
 * futures and paused ticks, and runs when the game thread next drains it.
 *
 * Keys must identify physical controls, not aliases (for example a resolved key
 * code or mouse button). Writers for the same key must manipulate the same
 * control. The first writer is retained until all leases/cleanup records finish,
 * so release is paired with the writer that performed acquisition. Writers are
 * invoked for necessary state transitions, not to synthesize
 * a repeated key-press event. Do not reenter this manager from a callback;
 * Scope.close is the exception and is always safe.
 */
public final class TemporaryInputLeases {
    private static final Logger LOG = Logger.getLogger(TemporaryInputLeases.class.getName());
    private static final TemporaryInputLeases INSTANCE = new TemporaryInputLeases(64, 128);

    private final int maxScopes;
    private final int maxControlsPerScope;
    private final Object scopeCreationLock = new Object();
    private final AtomicInteger scopeCount = new AtomicInteger();
    private final AtomicLong cleanupFailures = new AtomicLong();
    private final Set<Scope> scopes = ConcurrentHashMap.newKeySet();
    // The registry and each scope's acquisitions are confined to the game thread.
    private final Map<Object, Control> controls = new HashMap<>();

    public static TemporaryInputLeases getInstance() { return INSTANCE; }

    TemporaryInputLeases(int maxScopes, int maxControlsPerScope) {
        if (maxScopes <= 0 || maxControlsPerScope <= 0) {
            throw new IllegalArgumentException("Lease capacities must be positive");
        }
        this.maxScopes = maxScopes;
        this.maxControlsPerScope = maxControlsPerScope;
    }

    /** Reserves bounded cleanup capacity before any physical input can be changed. */
    public Scope openScope() {
        synchronized (scopeCreationLock) {
            if (scopeCount.get() >= maxScopes) throw new RejectedExecutionException("Temporary input scopes are full");
            Scope scope = new Scope();
            scopeCount.incrementAndGet();
            scopes.add(scope);
            return scope;
        }
    }

    /**
     * Marks all scopes existing at this call closed, without touching game state.
     * Shutdown still needs a final game-thread drain; this cannot execute cleanup
     * after the process/game thread has ended. Future scopes may be opened again.
     */
    public void closeAll() {
        synchronized (scopeCreationLock) {
            for (Scope scope : scopes) scope.close();
        }
    }

    /** Number of failed cleanup attempts; failures also log once per failure episode. */
    public long cleanupFailureCount() { return cleanupFailures.get(); }

    /**
     * Acquires one temporary hold. Returns false without writing if already closed.
     * Repeated acquisition by one scope is idempotent. A new control beyond the
     * per-scope limit is rejected before reading or writing that control; callers
     * must still close the scope in finally to release any earlier acquisitions.
     * Ownership is recorded before writing, even if the writer partly succeeds
     * then throws. Close racing with an already-started write is drained later.
     */
    public boolean acquire(Scope scope, Object physicalKey, BooleanSupplier isHeldInitially,
                           Consumer<Boolean> setHeld) {
        requireOwnScope(scope);
        Objects.requireNonNull(physicalKey, "physicalKey");
        Objects.requireNonNull(isHeldInitially, "isHeldInitially");
        Objects.requireNonNull(setHeld, "setHeld");
        if (scope.closed.get()) return false;
        if (scope.acquisitions.containsKey(physicalKey)) return true;
        if (scope.acquisitions.size() >= maxControlsPerScope) {
            throw new RejectedExecutionException("Temporary input controls are full");
        }
        Control control = controls.get(physicalKey);
        if (control == null) {
            boolean baseline = isHeldInitially.getAsBoolean();
            if (scope.closed.get()) return false;
            control = new Control(physicalKey, baseline, setHeld);
            controls.put(physicalKey, control);
        }
        if (scope.closed.get()) {
            if (control.references == 0) controls.remove(physicalKey);
            return false;
        }
        Acquisition acquisition = new Acquisition(control);
        scope.acquisitions.put(physicalKey, acquisition);
        control.owners++;
        control.references++;
        control.apply(true);
        return true;
    }

    /**
     * Sets explicit persistent intent, which survives temporary-scope closure.
     * Releasing persistent intent does not release another scope's temporary hold.
     * Without active/retained leases this simply writes the requested state and
     * retains no registry entry. While a control is tracked, only its baseline
     * changes; its original writer remains responsible for paired cleanup.
     */
    public void persistent(Object physicalKey, boolean held, Consumer<Boolean> setHeld) {
        Objects.requireNonNull(physicalKey, "physicalKey");
        Objects.requireNonNull(setHeld, "setHeld");
        Control control = controls.get(physicalKey);
        if (control == null) {
            setHeld.accept(held);
            return;
        }
        control.baseline = held;
        control.apply(control.owners > 0 || held);
    }

    /**
     * Game-thread tick cleanup. Each affected control is attempted once per drain.
     * Failed callbacks retain bounded cleanup records and are retried next tick;
     * one failure cannot prevent unrelated controls or scopes from being released.
     */
    public void drainClosed() {
        List<Scope> closing = new ArrayList<>();
        Set<Control> affected = new LinkedHashSet<>();
        for (Scope scope : scopes) {
            if (!scope.closed.get()) continue;
            closing.add(scope);
            for (Acquisition acquisition : scope.acquisitions.values()) {
                if (!acquisition.released) {
                    acquisition.released = true;
                    acquisition.control.owners--;
                }
                affected.add(acquisition.control);
            }
        }
        // Remove all closed owners before writing, so two simultaneously closing
        // scopes cannot cause a transient re-press while cleanup is in progress.
        Set<Control> settled = new LinkedHashSet<>();
        for (Control control : affected) {
            try {
                control.apply(control.owners > 0 || control.baseline);
                control.cleanupFailureReported = false;
                settled.add(control);
            } catch (Throwable failedCleanup) {
                cleanupFailures.incrementAndGet();
                if (!control.cleanupFailureReported) {
                    control.cleanupFailureReported = true;
                    try {
                        LOG.log(Level.WARNING, "Temporary input cleanup failed; retained for retry on a later game tick", failedCleanup);
                    } catch (RuntimeException unavailableLogger) {
                        // The monotonic failure counter remains available even if
                        // a host logging handler fails; other cleanup must proceed.
                    }
                }
                // Keep the scope/control reserved for a later tick, never discard
                // cleanup because its request's future timed out or was canceled.
            }
        }
        for (Scope scope : closing) {
            java.util.Iterator<Acquisition> iterator = scope.acquisitions.values().iterator();
            while (iterator.hasNext()) {
                Control control = iterator.next().control;
                if (!settled.contains(control)) continue;
                iterator.remove();
                control.references--;
                if (control.references == 0) controls.remove(control.key);
            }
            if (scope.acquisitions.isEmpty() && scopes.remove(scope)) scopeCount.decrementAndGet();
        }
    }

    private void requireOwnScope(Scope scope) {
        Objects.requireNonNull(scope, "scope");
        if (scope.owner != this) throw new IllegalArgumentException("Scope belongs to another lease registry");
    }

    int retainedScopes() { return scopeCount.get(); }
    int trackedControls() { return controls.size(); }

    public final class Scope implements AutoCloseable {
        private final TemporaryInputLeases owner = TemporaryInputLeases.this;
        private final AtomicBoolean closed = new AtomicBoolean();
        private final Map<Object, Acquisition> acquisitions = new LinkedHashMap<>();

        private Scope() {}
        public boolean isClosed() { return closed.get(); }
        /** Nonblocking, idempotent and safe with the worker's interrupt flag set. */
        @Override public void close() { closed.set(true); }
    }

    private static final class Acquisition {
        final Control control;
        boolean released;
        Acquisition(Control control) { this.control = control; }
    }

    private static final class Control {
        final Object key;
        boolean baseline;
        boolean applied;
        boolean dirty;
        boolean cleanupFailureReported;
        int owners;
        int references;
        final Consumer<Boolean> writer;

        Control(Object key, boolean baseline, Consumer<Boolean> writer) {
            this.key = key;
            this.baseline = baseline;
            this.applied = baseline;
            this.writer = writer;
        }

        void apply(boolean held) {
            if (!dirty && applied == held) return;
            dirty = true;
            writer.accept(held);
            applied = held;
            dirty = false;
        }
    }
}
