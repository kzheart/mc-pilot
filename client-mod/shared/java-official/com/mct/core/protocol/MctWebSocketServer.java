package com.mct.core.protocol;

import com.mct.core.handler.ActionDispatcher;
import com.mct.core.state.EventRecorder;
import com.mct.core.util.ActionException;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import net.minecraft.client.Minecraft;
import org.java_websocket.WebSocket;
import org.java_websocket.WebSocketImpl;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

public final class MctWebSocketServer extends WebSocketServer {
    private static MctWebSocketServer instance;
    private final WebSocketRequestService<WebSocket> requests;

    public MctWebSocketServer(int port, Minecraft client) {
        super(new InetSocketAddress("127.0.0.1", port));
        ActionDispatcher actions = new ActionDispatcher(client);
        requests = new WebSocketRequestService<>(30_000L, actions::execute,
            failure -> failure instanceof ActionException ? ((ActionException) failure).getCode() : "INTERNAL_ERROR",
            () -> {
                EventRecorder.Pointer pointer = EventRecorder.getInstance().drainPointer();
                return new WebSocketRequestService.Events(pointer.count, pointer.lastType);
            });
    }

    public static void startServer() {
        int port = Integer.parseInt(System.getenv().getOrDefault("MCT_CLIENT_WS_PORT", "25560"));
        instance = new MctWebSocketServer(port, Minecraft.getInstance());
        instance.start();
    }

    public static MctWebSocketServer getInstance() { return instance; }

    @Override public void onOpen(WebSocket conn, ClientHandshake handshake) {
        if (!requests.open(conn)) conn.close(1013, "MC-Pilot connection limit reached");
    }

    @Override public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        requests.closeConnection(conn);
    }

    @Override public void onMessage(WebSocket conn, String message) {
        requests.receive(conn, message, response -> sendResponse(conn, response));
    }

    private void sendResponse(WebSocket conn, String response) {
        if (!conn.isOpen()) return;
        // Java-WebSocket has an unbounded outgoing queue. Bound retained
        // response bytes and frames before handing another response to it.
        if (conn instanceof WebSocketImpl) {
            WebSocketImpl socket = (WebSocketImpl) conn;
            long buffered = response.length() * 3L;
            for (ByteBuffer frame : socket.outQueue) buffered += frame.remaining();
            if (socket.outQueue.size() >= 64 || buffered > 4L * 1024 * 1024) {
                requests.closeConnection(conn);
                conn.closeConnection(1013, "MC-Pilot response backpressure");
                return;
            }
        }
        try { conn.send(response); }
        catch (RuntimeException closed) { requests.closeConnection(conn); }
    }

    @Override public void stop(int timeout, String closeMessage) throws InterruptedException {
        try { requests.close(); }
        finally { super.stop(timeout, closeMessage); }
    }

    @Override public void onError(WebSocket conn, Exception exception) {
        if (conn == null && exception instanceof java.net.BindException) requests.close();
        exception.printStackTrace();
    }

    @Override public void onStart() {}
}
