package com.mct.core.protocol;

import com.mct.core.handler.ActionDispatcher;
import com.mct.core.state.EventRecorder;
import com.mct.core.util.ActionException;
import java.net.InetSocketAddress;
import java.util.Map;
import java.util.UUID;
import net.minecraft.client.MinecraftClient;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

public final class MctWebSocketServer extends WebSocketServer {

    private static MctWebSocketServer instance;

    private final ActionDispatcher dispatcher;

    public MctWebSocketServer(int port, MinecraftClient client) {
        super(new InetSocketAddress("127.0.0.1", port));
        this.dispatcher = new ActionDispatcher(client);
    }

    public static void startServer() {
        int port = Integer.parseInt(System.getenv().getOrDefault("MCT_CLIENT_WS_PORT", "25560"));
        MinecraftClient client = MinecraftClient.getInstance();
        instance = new MctWebSocketServer(port, client);
        instance.start();
    }

    public static MctWebSocketServer getInstance() {
        return instance;
    }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        Request request = JsonUtil.fromJson(message, Request.class);
        Response response;

        try {
            Map<String, Object> data = dispatcher.execute(request.action(), request.params());
            EventRecorder.Pointer pointer = EventRecorder.getInstance().drainPointer();
            response = new Response(request.id(), true, data, null, pointer.count, pointer.lastType);
        } catch (ActionException exception) {
            EventRecorder.Pointer pointer = EventRecorder.getInstance().drainPointer();
            response = new Response(
                request.id() != null ? request.id() : UUID.randomUUID().toString(),
                false,
                null,
                exception.getCode(),
                pointer.count,
                pointer.lastType
            );
        } catch (Exception exception) {
            exception.printStackTrace();
            EventRecorder.Pointer pointer = EventRecorder.getInstance().drainPointer();
            response = new Response(
                request.id() != null ? request.id() : UUID.randomUUID().toString(),
                false,
                null,
                "INTERNAL_ERROR",
                pointer.count,
                pointer.lastType
            );
        }

        conn.send(JsonUtil.toJson(response));
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        ex.printStackTrace();
    }

    @Override
    public void onStart() {
    }
}
