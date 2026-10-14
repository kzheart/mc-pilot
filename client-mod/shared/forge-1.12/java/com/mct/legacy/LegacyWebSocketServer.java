package com.mct.legacy;

import com.google.gson.Gson;
import com.mct.core.protocol.WebSocketRequestService;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/** RFC 6455 transport; shared bounded dispatch never blocks its frame readers. */
public final class LegacyWebSocketServer extends Thread {
    private static final String WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final Gson GSON = new Gson();
    private final int port;
    private final WebSocketRequestService<Socket> requests;
    private final Set<Socket> connections = ConcurrentHashMap.newKeySet();
    private final AtomicBoolean closing = new AtomicBoolean();
    private volatile ServerSocket listener;

    public LegacyWebSocketServer(int port, ActionRouter router) {
        super("mct-forge-1.12-websocket");
        this.port = port;
        this.requests = new WebSocketRequestService<>(10_000L,
            (action, params) -> router.execute(action, GSON.toJsonTree(params).getAsJsonObject()),
            failure -> failure instanceof LegacyActionException ? ((LegacyActionException) failure).code : "INTERNAL_ERROR",
            () -> new WebSocketRequestService.Events(0, null));
        setDaemon(true);
    }

    @Override public void run() {
        try (ServerSocket server = new ServerSocket(port, 16, InetAddress.getByName("127.0.0.1"))) {
            listener = server;
            while (!closing.get()) {
                final Socket socket = server.accept();
                // Bound even pre-handshake readers; incomplete handshakes expire.
                if (connections.size() >= 64 || closing.get()) { socket.close(); continue; }
                connections.add(socket);
                Thread reader = new Thread(() -> handleConnection(socket), "mct-forge-1.12-reader");
                reader.setDaemon(true);
                reader.start();
            }
        } catch (IOException exception) {
            if (!closing.get()) exception.printStackTrace();
        } finally { shutdown(); }
    }

    public void shutdown() {
        closing.set(true);
        ServerSocket server = listener;
        if (server != null) try { server.close(); } catch (IOException ignored) {}
        for (Socket socket : connections) closeSocket(socket);
        requests.close();
    }

    private void closeSocket(Socket socket) {
        requests.closeConnection(socket);
        try { socket.close(); } catch (IOException ignored) {}
    }

    private void handleConnection(Socket socket) {
        Connection outputQueue = null;
        try (Socket connection = socket;
             BufferedInputStream input = new BufferedInputStream(connection.getInputStream());
             BufferedOutputStream output = new BufferedOutputStream(connection.getOutputStream())) {
            connection.setSoTimeout(5_000);
            String websocketKey = readHandshake(input);
            writeHandshake(output, websocketKey);
            connection.setSoTimeout(0);
            if (!requests.open(connection)) return;
            outputQueue = new Connection(connection, output);
            final Connection writer = outputQueue;
            while (!connection.isClosed()) {
                Frame frame = readFrame(input);
                if (frame.opcode == 8) {
                    requests.closeConnection(connection);
                    writer.send(8, new byte[0]);
                    writer.thread.join(250L);
                    // Close the raw socket before buffered-stream cleanup: a slow
                    // writer may otherwise hold the output monitor indefinitely.
                    closeSocket(connection);
                    break;
                }
                if (frame.opcode == 9) { writer.send(10, frame.payload); continue; }
                if (frame.opcode != 1) continue;
                requests.receive(connection, new String(frame.payload, StandardCharsets.UTF_8),
                    response -> writer.send(1, response.getBytes(StandardCharsets.UTF_8)));
            }
        } catch (EOFException ignored) {
        } catch (Exception exception) {
            if (!closing.get() && !socket.isClosed()) exception.printStackTrace();
        } finally {
            closeSocket(socket);
            if (outputQueue != null) outputQueue.thread.interrupt();
            connections.remove(socket);
        }
    }

    /** Bounded async writes keep a slow peer from occupying a command worker or watchdog. */
    private final class Connection {
        final Socket socket;
        // One active plus sixteen accepted actions may complete before the writer
        // runs. Leave bounded headroom for that burst, BUSY replies and control
        // frames; the independent 4 MiB limit still bounds retained payloads.
        final ArrayBlockingQueue<Frame> pending = new ArrayBlockingQueue<>(64);
        final AtomicLong bufferedBytes = new AtomicLong();
        final Thread thread;

        Connection(Socket socket, BufferedOutputStream output) {
            this.socket = socket;
            thread = new Thread(() -> {
                try {
                    while (!socket.isClosed()) {
                        Frame frame = pending.take();
                        writeFrame(output, frame.opcode, frame.payload);
                        bufferedBytes.addAndGet(-frame.payload.length);
                        if (frame.opcode == 8) return;
                    }
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                } catch (IOException ignored) {
                } finally { pending.clear(); closeSocket(socket); }
            }, "mct-forge-1.12-writer");
            thread.setDaemon(true);
            thread.start();
        }

        void send(int opcode, byte[] payload) {
            if (socket.isClosed()) return;
            long bytes = bufferedBytes.addAndGet(payload.length);
            if (bytes > 4L * 1024 * 1024 || !pending.offer(new Frame(opcode, payload))) {
                bufferedBytes.addAndGet(-payload.length);
                // No safe room for another frame; terminate and leave submitted outcomes unknown.
                closeSocket(socket);
                thread.interrupt();
            }
        }
    }

    private String readHandshake(BufferedInputStream input) throws IOException {
        String headers = readHttpHeaders(input);
        for (String line : headers.split("\\r\\n")) {
            int separator = line.indexOf(':');
            if (separator > 0 && "sec-websocket-key".equalsIgnoreCase(line.substring(0, separator).trim())) {
                return line.substring(separator + 1).trim();
            }
        }
        throw new IOException("Missing Sec-WebSocket-Key");
    }

    private String readHttpHeaders(BufferedInputStream input) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        int matched = 0;
        while (bytes.size() < 16384) {
            int value = input.read();
            if (value < 0) {
                throw new EOFException();
            }
            bytes.write(value);
            int expected = matched == 0 || matched == 2 ? '\r' : '\n';
            if (value == expected) {
                matched++;
                if (matched == 4) {
                    return new String(bytes.toByteArray(), StandardCharsets.US_ASCII);
                }
            } else {
                matched = value == '\r' ? 1 : 0;
            }
        }
        throw new IOException("HTTP headers too large");
    }

    private void writeHandshake(BufferedOutputStream output, String key) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-1");
        String accept = Base64.getEncoder().encodeToString(
            digest.digest((key + WEBSOCKET_GUID).getBytes(StandardCharsets.US_ASCII))
        );
        String response =
            "HTTP/1.1 101 Switching Protocols\r\n"
                + "Upgrade: websocket\r\n"
                + "Connection: Upgrade\r\n"
                + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
        output.write(response.getBytes(StandardCharsets.US_ASCII));
        output.flush();
    }

    private Frame readFrame(BufferedInputStream input) throws IOException {
        int first = input.read();
        int second = input.read();
        if (first < 0 || second < 0) {
            throw new EOFException();
        }
        int opcode = first & 0x0f;
        boolean masked = (second & 0x80) != 0;
        long length = second & 0x7f;
        if (length == 126) {
            length = ((long) readRequired(input) << 8) | readRequired(input);
        } else if (length == 127) {
            length = 0;
            for (int index = 0; index < 8; index++) {
                length = (length << 8) | readRequired(input);
            }
        }
        if (length < 0 || length > 4L * 1024 * 1024) {
            throw new IOException("WebSocket frame too large");
        }
        byte[] mask = masked ? readBytes(input, 4) : null;
        byte[] payload = readBytes(input, (int) length);
        if (mask != null) {
            for (int index = 0; index < payload.length; index++) {
                payload[index] = (byte) (payload[index] ^ mask[index % 4]);
            }
        }
        return new Frame(opcode, payload);
    }

    private void writeFrame(BufferedOutputStream output, int opcode, byte[] payload) throws IOException {
        synchronized (output) {
            output.write(0x80 | opcode);
            if (payload.length < 126) {
                output.write(payload.length);
            } else if (payload.length <= 65535) {
                output.write(126);
                output.write((payload.length >>> 8) & 0xff);
                output.write(payload.length & 0xff);
            } else {
                output.write(127);
                for (int shift = 56; shift >= 0; shift -= 8) {
                    output.write((int) (((long) payload.length >>> shift) & 0xff));
                }
            }
            output.write(payload);
            output.flush();
        }
    }

    private int readRequired(BufferedInputStream input) throws IOException {
        int value = input.read();
        if (value < 0) {
            throw new EOFException();
        }
        return value;
    }

    private byte[] readBytes(BufferedInputStream input, int length) throws IOException {
        byte[] bytes = new byte[length];
        int offset = 0;
        while (offset < length) {
            int read = input.read(bytes, offset, length - offset);
            if (read < 0) {
                throw new EOFException();
            }
            offset += read;
        }
        return bytes;
    }

    private static final class Frame {
        final int opcode;
        final byte[] payload;

        Frame(int opcode, byte[] payload) {
            this.opcode = opcode;
            this.payload = payload;
        }
    }
}
