package com.mct.core.concurrent;

import java.util.Objects;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.function.BiConsumer;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Owns the result of one asynchronous resource creation until explicitly claimed.
 * A canceled/interrupted waiter closes this owner, not the shared creation future:
 * a game task that already started may still produce a resource after cancellation.
 *
 * No threads, queues, or waits are created. Resource disposal executes inline on
 * the closing/completing thread, outside the ownership lock. Thus close never waits
 * for the future, but an already-available resource's own close may take time.
 */
public final class AsyncResource<T extends AutoCloseable> implements AutoCloseable {
    private static final Logger LOG = Logger.getLogger(AsyncResource.class.getName());
    private final Object lock = new Object();
    private CompletableFuture<T> future;
    private T owned;
    private boolean tracked;
    private boolean closed;
    private boolean claimed;
    private boolean disposed;

    public AsyncResource() {}

    /** Registers exactly one future, including after close if creation already started. */
    public CompletableFuture<T> track(CompletableFuture<T> future) {
        Objects.requireNonNull(future, "future");
        synchronized (lock) {
            if (tracked) throw new IllegalStateException("An async resource owner tracks exactly one future");
            tracked = true;
            this.future = future;
        }
        future.whenComplete(new BiConsumer<T, Throwable>() {
            @Override public void accept(T resource, Throwable failure) { completed(resource, failure); }
        });
        return future;
    }

    /**
     * Transfers the successfully completed resource to the caller, which must close
     * it normally. A get/join may finish before our completion callback runs, so
     * identity is checked against the future itself. If abandonment wins the race,
     * this throws CancellationException; the caller must not close that resource.
     */
    public T claim(T resource) {
        Objects.requireNonNull(resource, "resource");
        synchronized (lock) {
            if (closed) throw new CancellationException("Async resource owner was abandoned");
            if (claimed) throw new IllegalStateException("Async resource ownership was already claimed");
            if (!tracked || !future.isDone()) throw new IllegalStateException("Resource future has not completed");
            if (future.getNow(null) != resource) throw new IllegalArgumentException("Resource does not belong to the tracked future");
            claimed = true;
            owned = null;
            return resource;
        }
    }

    private void completed(T resource, Throwable failure) {
        if (failure != null || resource == null) return;
        T abandoned = null;
        synchronized (lock) {
            if (claimed || disposed) return;
            if (closed) {
                disposed = true;
                abandoned = resource;
            } else {
                owned = resource;
            }
        }
        dispose(abandoned);
    }

    /** Marks abandonment without waiting; an eventual unclaimed result is closed once. */
    @Override public void close() {
        T abandoned = null;
        synchronized (lock) {
            if (closed) return;
            closed = true;
            if (!claimed && !disposed && owned != null) {
                disposed = true;
                abandoned = owned;
                owned = null;
            }
        }
        dispose(abandoned);
    }

    private void dispose(T resource) {
        if (resource == null) return;
        try {
            resource.close();
        } catch (Exception failure) {
            // Ownership has already been discharged. Retrying close could itself
            // double-free a native image if its first close partly succeeded.
            try { LOG.log(Level.WARNING, "Unable to close abandoned async resource", failure); }
            catch (RuntimeException unavailableLogger) { /* cleanup never retries */ }
        }
    }
}
