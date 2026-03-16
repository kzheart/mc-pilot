package com.mct.core.protocol;

import com.mct.core.util.ClientActionExecutor;
import java.net.InetSocketAddress;
import java.util.Map;
import java.util.UUID;
import net.minecraft.client.MinecraftClient;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

public final class MctWebSocketServer extends WebSocketServer {

    private final ClientActionExecutor executor;

    public MctWebSocketServer(int port, MinecraftClient client) {
        super(new InetSocketAddress("127.0.0.1", port));
        this.executor = new ClientActionExecutor(client);
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
            Map<String, Object> data = executor.execute(request.action(), request.params());
            response = new Response(request.id(), true, data, null);
        } catch (ClientActionExecutor.ActionException exception) {
            response = new Response(
                request.id() != null ? request.id() : UUID.randomUUID().toString(),
                false,
                null,
                exception.getCode()
            );
        } catch (Exception exception) {
            exception.printStackTrace();
            response = new Response(
                request.id() != null ? request.id() : UUID.randomUUID().toString(),
                false,
                null,
                "INTERNAL_ERROR"
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
