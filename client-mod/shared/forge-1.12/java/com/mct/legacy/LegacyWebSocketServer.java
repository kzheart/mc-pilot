package com.mct.legacy;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
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
import java.util.LinkedHashMap;
import java.util.Map;

/** Minimal RFC 6455 server; each request is dispatched through the ActionRouter. */
public final class LegacyWebSocketServer extends Thread {

    private static final String WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final Gson GSON = new GsonBuilder().serializeNulls().create();
    private final int port;
    private final ActionRouter router;

    public LegacyWebSocketServer(int port, ActionRouter router) {
        super("mct-forge-1.12-websocket");
        this.port = port;
        this.router = router;
        setDaemon(true);
    }

    @Override
    public void run() {
        try (ServerSocket listener = new ServerSocket(port, 16, InetAddress.getByName("127.0.0.1"))) {
            while (!isInterrupted()) {
                final Socket socket = listener.accept();
                Thread connection = new Thread(new Runnable() {
                    @Override
                    public void run() {
                        handleConnection(socket);
                    }
                }, "mct-forge-1.12-connection");
                connection.setDaemon(true);
                connection.start();
            }
        } catch (IOException exception) {
            exception.printStackTrace();
        }
    }

    private void handleConnection(Socket socket) {
        try (Socket connection = socket;
             BufferedInputStream input = new BufferedInputStream(connection.getInputStream());
             BufferedOutputStream output = new BufferedOutputStream(connection.getOutputStream())) {
            String websocketKey = readHandshake(input);
            writeHandshake(output, websocketKey);
            while (!connection.isClosed()) {
                Frame frame = readFrame(input);
                if (frame.opcode == 8) {
                    writeFrame(output, 8, new byte[0]);
                    break;
                }
                if (frame.opcode == 9) {
                    writeFrame(output, 10, frame.payload);
                    continue;
                }
                if (frame.opcode != 1) {
                    continue;
                }
                String request = new String(frame.payload, StandardCharsets.UTF_8);
                String response = executeRequest(request);
                writeFrame(output, 1, response.getBytes(StandardCharsets.UTF_8));
            }
        } catch (EOFException ignored) {
        } catch (Exception exception) {
            exception.printStackTrace();
        }
    }

    private String executeRequest(String raw) {
        JsonObject request = new JsonParser().parse(raw).getAsJsonObject();
        String id = Params.string(request, "id");
        String action = Params.string(request, "action");
        JsonObject params = request.has("params") && request.get("params").isJsonObject()
            ? request.getAsJsonObject("params")
            : new JsonObject();
        Map<String, Object> response = new LinkedHashMap<String, Object>();
        response.put("id", id);
        try {
            Map<String, Object> data = router.execute(action, params);
            response.put("success", true);
            response.put("data", data);
            response.put("error", null);
        } catch (LegacyActionException exception) {
            response.put("success", false);
            response.put("data", null);
            response.put("error", exception.code);
        } catch (Exception exception) {
            exception.printStackTrace();
            response.put("success", false);
            response.put("data", null);
            response.put("error", "INTERNAL_ERROR");
        }
        response.put("eventsSinceLastCall", 0);
        response.put("lastEventType", null);
        return GSON.toJson(response);
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
        if (length > 4L * 1024 * 1024) {
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
                    output.write((payload.length >>> shift) & 0xff);
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
