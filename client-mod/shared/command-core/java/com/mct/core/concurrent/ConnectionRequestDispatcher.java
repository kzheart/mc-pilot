package com.mct.core.concurrent;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Callable;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import java.util.function.LongSupplier;

/**
 * Server-owned, bounded command executor. Never run a command on a WebSocket
 * read/selector thread: commands may wait for a Minecraft client tick.
 *
 * Each connection has a FIFO lane; workers take one job per turn before putting
 * that lane at the back of the ready queue. Four workers, 64 connection/ready
 * lanes and 16 pending jobs per lane bound both threads and retained requests.
 * There is one periodic deadline scan, not a scheduled task for every request.
 * Explicit deadlines cover queueing and execution and use elapsed monotonic time.
 * Compatibility submissions may instead limit only queueing time.
 *
 * Callbacks must be short and nonblocking (typically a WebSocket send). A busy
 * rejection calls its failure callback synchronously. Completion callbacks run
 * on a worker or the watchdog; they must not wait for another dispatcher job.
 * Close suppresses callbacks not yet claimed for delivery and interrupts active waits.
 * A callback already claimed may finish after close; transport sends must also
 * check that their connection is still open. Close never waits for a callback.
 * Interruption cannot undo a game-thread operation that has already started.
 */
public final class ConnectionRequestDispatcher<K> implements AutoCloseable {
    public enum FailureCode { BUSY, TIMEOUT, INTERNAL }

    public static final class Failure {
        private final FailureCode code;
        private final boolean started;
        private final Throwable cause;

        private Failure(FailureCode code, boolean started, Throwable cause) {
            this.code = code;
            this.started = started;
            this.cause = cause;
        }

        public FailureCode getCode() { return code; }
        /** True once a worker claimed the action; the underlying effect may have started. */
        public boolean isStarted() { return started; }
        /** A started failed/timed-out command cannot safely be assumed to have had no effect. */
        public boolean isResultUnknown() { return started; }
        public Throwable getCause() { return cause; }
    }

    private static final AtomicInteger IDS = new AtomicInteger();
    private final Object lock = new Object();
    private final Map<K, Lane> lanes = new HashMap<>();
    private final ArrayBlockingQueue<Lane> ready;
    private final List<Thread> workers = new ArrayList<>();
    private final int maxConnections;
    private final int pendingPerConnection;
    private final LongSupplier nanoTime;
    private final ScheduledThreadPoolExecutor watchdog;
    private boolean closed;

    public ConnectionRequestDispatcher() {
        this(4, 64, 64, 16, 10, System::nanoTime);
    }

    /** Package-private small limits and clock injection for standalone tests. */
    ConnectionRequestDispatcher(int workerCount, int readyCapacity, int maxConnections,
                                int pendingPerConnection, long scanMillis, LongSupplier nanoTime) {
        if (workerCount <= 0 || maxConnections <= 0 || readyCapacity < maxConnections
                || pendingPerConnection <= 0 || scanMillis <= 0) {
            throw new IllegalArgumentException("Positive limits and ready capacity >= connection limit required");
        }
        this.ready = new ArrayBlockingQueue<>(readyCapacity);
        this.maxConnections = maxConnections;
        this.pendingPerConnection = pendingPerConnection;
        this.nanoTime = Objects.requireNonNull(nanoTime, "nanoTime");
        final String prefix = "mcpilot-ws-dispatch-" + IDS.incrementAndGet() + "-";
        ThreadFactory factory = new ThreadFactory() {
            private final AtomicInteger sequence = new AtomicInteger();
            @Override public Thread newThread(Runnable runnable) {
                Thread thread = new Thread(runnable, prefix + sequence.incrementAndGet());
                thread.setDaemon(true);
                return thread;
            }
        };
        watchdog = new ScheduledThreadPoolExecutor(1, factory);
        watchdog.setRemoveOnCancelPolicy(true);
        watchdog.setExecuteExistingDelayedTasksAfterShutdownPolicy(false);
        watchdog.setContinueExistingPeriodicTasksAfterShutdownPolicy(false);
        for (int i = 0; i < workerCount; i++) {
            workers.add(factory.newThread(this::work));
        }
        for (Thread worker : workers) {
            worker.start();
        }
        watchdog.scheduleWithFixedDelay(this::expireRequests, scanMillis, scanMillis, TimeUnit.MILLISECONDS);
    }

    /** Returns false if the server is closed or its connection limit is reached. */
    public boolean open(K connection) {
        Objects.requireNonNull(connection, "connection");
        synchronized (lock) {
            if (closed) return false;
            if (lanes.containsKey(connection)) return true;
            if (lanes.size() >= maxConnections) return false;
            lanes.put(connection, new Lane());
            return true;
        }
    }

    /**
     * Returns true only when accepted. Unknown/closed connections fail silently;
     * full lanes return false and report BUSY immediately, without running action.
     */
    public <T> boolean submit(K connection, long timeoutMillis, Callable<T> action,
                              Consumer<T> success, Consumer<Failure> failure) {
        return submit(connection, timeoutMillis, nanoTime.getAsLong(), true, action, success, failure);
    }

    /**
     * Accepts the monotonic receipt timestamp so parsing/admission consume the
     * same budget. Set includeExecutionTime false only for old clients whose
     * existing handler-specific execution timeouts must remain unchanged.
     */
    public <T> boolean submit(K connection, long timeoutMillis, long receivedAtNanos,
                              boolean includeExecutionTime, Callable<T> action,
                              Consumer<T> success, Consumer<Failure> failure) {
        Objects.requireNonNull(connection, "connection");
        Objects.requireNonNull(action, "action");
        Objects.requireNonNull(success, "success");
        Objects.requireNonNull(failure, "failure");
        if (timeoutMillis <= 0) throw new IllegalArgumentException("Timeout must be positive");
        Lane lane;
        synchronized (lock) {
            lane = lanes.get(connection);
            if (closed || lane == null || lane.closed) return false;
            if (lane.pending.size() < pendingPerConnection) {
                lane.pending.addLast(new Job<T>(lane, timeoutMillis, receivedAtNanos, includeExecutionTime, action, success, failure));
                makeReady(lane);
                return true;
            }
        }
        deliver(lane, () -> failure.accept(new Failure(FailureCode.BUSY, false, null)));
        return false;
    }

    /** Cancels this connection's pending work and interrupts its active worker wait. */
    public void closeConnection(K connection) {
        synchronized (lock) {
            Lane lane = lanes.remove(connection);
            if (lane != null) cancelLane(lane);
        }
    }

    /** Idempotent. Interruptible workers stop promptly; effects already running cannot be undone. */
    @Override public void close() {
        synchronized (lock) {
            if (closed) return;
            closed = true;
            for (Lane lane : lanes.values()) cancelLane(lane);
            lanes.clear();
            ready.clear();
            for (Thread worker : workers) worker.interrupt();
            lock.notifyAll();
        }
        watchdog.shutdownNow();
    }

    private void cancelLane(Lane lane) {
        lane.closed = true;
        ready.remove(lane);
        lane.queued = false;
        for (Job<?> job : lane.pending) job.terminal = true;
        lane.pending.clear();
        if (lane.active != null) {
            lane.active.terminal = true;
            interruptOwner(lane.active);
        }
    }

    /** Called only with lock held; at most one ready entry exists per open lane. */
    private void makeReady(Lane lane) {
        if (!lane.closed && !lane.queued && lane.active == null && !lane.pending.isEmpty()) {
            // There are <= maxConnections lanes and readyCapacity >= maxConnections.
            if (!ready.offer(lane)) {
                throw new IllegalStateException("Ready-lane capacity invariant violated");
            }
            lane.queued = true;
            lock.notifyAll();
        }
    }

    private void work() {
        for (;;) {
            Job<?> job;
            synchronized (lock) {
                while (!closed && ready.isEmpty()) {
                    try { lock.wait(); } catch (InterruptedException ignored) { /* recheck state */ }
                }
                if (closed) return;
                // Clear only while holding the ownership lock, before claiming another job.
                Thread.interrupted();
                Lane lane = ready.remove();
                lane.queued = false;
                job = lane.pending.removeFirst();
                lane.active = job;
                if (!job.expired()) {
                    job.started = true;
                    job.runner = Thread.currentThread();
                }
            }
            run(job);
        }
    }

    private <T> void run(Job<T> job) {
        T result = null;
        Throwable thrown = null;
        if (job.started) {
            try {
                // Close/expiry may win immediately after ownership is assigned.
                if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
                result = job.action.call();
            } catch (Throwable failure) {
                thrown = failure;
            }
        }
        Failure failure = null;
        boolean respond = false;
        synchronized (lock) {
            if (!job.terminal) {
                job.terminal = true;
                respond = true;
                if (!job.started || (job.includeExecutionTime && job.expired())) {
                    failure = new Failure(FailureCode.TIMEOUT, job.started, null);
                } else if (thrown != null) {
                    failure = new Failure(FailureCode.INTERNAL, true, thrown);
                }
            }
            // Cancelling threads can interrupt only an owner observed under this lock.
            // Clear the flag before releasing ownership so it cannot affect another job.
            Thread.interrupted();
            job.runner = null;
            job.lane.active = null;
        }
        if (respond) {
            final T value = result;
            final Failure error = failure;
            deliver(job.lane, () -> {
                if (error == null) job.success.accept(value);
                else job.failure.accept(error);
            });
        }
        synchronized (lock) {
            Thread.interrupted();
            makeReady(job.lane);
        }
    }

    private void expireRequests() {
        List<Runnable> replies = new ArrayList<>();
        synchronized (lock) {
            if (closed) return;
            for (Lane lane : lanes.values()) {
                Iterator<Job<?>> iterator = lane.pending.iterator();
                while (iterator.hasNext()) {
                    Job<?> job = iterator.next();
                    if (job.expired()) {
                        iterator.remove();
                        expire(job, replies);
                    }
                }
                if (lane.queued && lane.pending.isEmpty()) {
                    ready.remove(lane);
                    lane.queued = false;
                }
                if (lane.active != null && !lane.active.terminal
                        && lane.active.includeExecutionTime && lane.active.expired()) {
                    expire(lane.active, replies);
                }
            }
        }
        for (Runnable reply : replies) reply.run();
    }

    private void expire(Job<?> job, List<Runnable> replies) {
        job.terminal = true;
        interruptOwner(job);
        Failure failure = new Failure(FailureCode.TIMEOUT, job.started, null);
        replies.add(() -> deliver(job.lane, () -> job.failure.accept(failure)));
    }

    private void interruptOwner(Job<?> job) {
        if (job.runner != null) job.runner.interrupt();
    }

    private void deliver(Lane lane, Runnable callback) {
        synchronized (lock) {
            if (closed || lane.closed) return;
            // Claim delivery atomically with close, but never call or wait for
            // external code under a dispatcher lock. WebSocket close callbacks
            // can hold the transport's own monitor and must not deadlock with send.
        }
        try {
            callback.run();
        } catch (Throwable ignored) {
            // Sending to a closing socket must not kill workers or the deadline scan.
        }
    }

    private final class Lane {
        final ArrayDeque<Job<?>> pending = new ArrayDeque<>();
        Job<?> active;
        boolean queued;
        boolean closed;
    }

    private final class Job<T> {
        final Lane lane;
        final long submittedAt;
        final boolean includeExecutionTime;
        final long timeoutNanos;
        final Callable<T> action;
        final Consumer<T> success;
        final Consumer<Failure> failure;
        boolean started;
        boolean terminal;
        Thread runner;

        Job(Lane lane, long timeoutMillis, long receivedAtNanos, boolean includeExecutionTime,
            Callable<T> action, Consumer<T> success, Consumer<Failure> failure) {
            this.lane = lane;
            this.submittedAt = receivedAtNanos;
            this.includeExecutionTime = includeExecutionTime;
            this.timeoutNanos = TimeUnit.MILLISECONDS.toNanos(timeoutMillis);
            this.action = action;
            this.success = success;
            this.failure = failure;
        }

        boolean expired() { return nanoTime.getAsLong() - submittedAt >= timeoutNanos; }
    }
}
