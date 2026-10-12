package com.mct.core.concurrent;

import java.util.Objects;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Callable;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.LongSupplier;

/**
 * Main-thread command mailbox independent of Minecraft's disposable task queue.
 * The client tick hook drains it even when no world is loaded. Adapters must run
 * calls made on the client thread directly instead of waiting for a later tick.
 */
public final class ClientTaskQueue {

    private static final ClientTaskQueue INSTANCE = new ClientTaskQueue(
        1024, 64, TimeUnit.MILLISECONDS.toNanos(5), System::nanoTime
    );

    private final ArrayBlockingQueue<QueuedTask<?>> pending;
    private final int maxTasksPerDrain;
    private final long maxDrainNanos;
    private final LongSupplier nanoTime;
    private final AtomicReference<Thread> drainThread = new AtomicReference<>();

    ClientTaskQueue(int capacity, int maxTasksPerDrain, long maxDrainNanos, LongSupplier nanoTime) {
        if (capacity <= 0 || maxTasksPerDrain <= 0 || maxDrainNanos <= 0) {
            throw new IllegalArgumentException("Queue and drain limits must be positive");
        }
        this.pending = new ArrayBlockingQueue<>(capacity);
        this.maxTasksPerDrain = maxTasksPerDrain;
        this.maxDrainNanos = maxDrainNanos;
        this.nanoTime = Objects.requireNonNull(nanoTime, "nanoTime");
    }

    public static ClientTaskQueue getInstance() {
        return INSTANCE;
    }

    /**
     * Waits for one main-thread operation. A timed-out/interrupted pending task
     * is canceled and removed, so it cannot execute when the client resumes.
     * An operation that already started cannot safely be interrupted or undone.
     * Saturation is reported as an ExecutionException with a rejection cause.
     */
    public <T> T call(Callable<T> operation, long timeoutMillis)
        throws ExecutionException, TimeoutException, InterruptedException {
        Objects.requireNonNull(operation, "operation");
        if (timeoutMillis <= 0) {
            throw new IllegalArgumentException("Timeout must be positive");
        }
        if (Thread.interrupted()) {
            throw new InterruptedException();
        }
        if (drainThread.get() == Thread.currentThread()) {
            try {
                return operation.call();
            } catch (Throwable failure) {
                throw new ExecutionException(failure);
            }
        }

        QueuedTask<T> task = new QueuedTask<>(operation, timeoutMillis);
        if (!pending.offer(task)) {
            throw new ExecutionException(new RejectedExecutionException("Client command queue is full"));
        }
        try {
            long remaining = task.remainingNanos();
            if (remaining <= 0) {
                throw new TimeoutException("Client command timed out before execution");
            }
            return task.get(remaining, TimeUnit.NANOSECONDS);
        } catch (CancellationException expired) {
            throw new TimeoutException("Client command timed out before execution");
        } finally {
            // FutureTask cancellation is also checked by run(); canceling only a
            // separate CompletableFuture would still allow a late side effect.
            if (!task.isDone()) {
                task.cancel(false);
            }
            pending.remove(task);
        }
    }

    /** Called on the client thread. Budgets bound work between frames, not an individual operation. */
    public void drain() {
        Thread current = Thread.currentThread();
        if (!drainThread.compareAndSet(null, current)) {
            return;
        }
        long started = nanoTime.getAsLong();
        try {
            for (int count = 0; count < maxTasksPerDrain; count++) {
                if (count > 0 && nanoTime.getAsLong() - started >= maxDrainNanos) {
                    return;
                }
                QueuedTask<?> task = pending.poll();
                if (task == null) {
                    return;
                }
                task.run();
            }
        } finally {
            drainThread.set(null);
        }
    }

    int pendingTasks() {
        return pending.size();
    }

    private final class QueuedTask<T> extends FutureTask<T> {
        private final long submittedAt;
        private final long timeoutNanos;

        QueuedTask(Callable<T> operation, long timeoutMillis) {
            super(operation);
            this.submittedAt = nanoTime.getAsLong();
            this.timeoutNanos = TimeUnit.MILLISECONDS.toNanos(timeoutMillis);
        }

        long remainingNanos() {
            return timeoutNanos - (nanoTime.getAsLong() - submittedAt);
        }

        @Override
        public void run() {
            if (remainingNanos() <= 0) {
                cancel(false);
                return;
            }
            super.run();
        }
    }
}
