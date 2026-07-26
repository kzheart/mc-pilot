package com.mct.legacy;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
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
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import net.minecraft.client.Minecraft;
import net.minecraft.client.entity.EntityPlayerSP;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.common.event.FMLInitializationEvent;

@Mod(
    modid = LegacyForgeEntrypoint.MOD_ID,
    name = "Minecraft Auto Test Client Mod",
    version = "0.9.1",
    clientSideOnly = true,
    acceptableRemoteVersions = "*"
)
public final class LegacyForgeEntrypoint {

    public static final String MOD_ID = "mct";
    private static LegacyWebSocketServer server;

    @Mod.EventHandler
    public void initialize(FMLInitializationEvent event) {
        if (server != null) {
            return;
        }
        int port = Integer.parseInt(environment("MCT_CLIENT_WS_PORT", "25560"));
        server = new LegacyWebSocketServer(port);
        server.start();
    }

    private static String environment(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isEmpty() ? fallback : value;
    }

    private static final class LegacyWebSocketServer extends Thread {

        private static final String WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
        private static final Gson GSON = new GsonBuilder().serializeNulls().create();
        private final int port;

        LegacyWebSocketServer(int port) {
            super("mct-forge-1.12-websocket");
            this.port = port;
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
            String id = stringValue(request, "id");
            String action = stringValue(request, "action");
            JsonObject params = request.has("params") && request.get("params").isJsonObject()
                ? request.getAsJsonObject("params")
                : new JsonObject();
            Map<String, Object> response = new LinkedHashMap<String, Object>();
            response.put("id", id);
            try {
                Map<String, Object> data = executeOnClient(action, params);
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

        private Map<String, Object> executeOnClient(final String action, final JsonObject params)
            throws Exception {
            final Minecraft client = Minecraft.getMinecraft();
            try {
                return client.addScheduledTask(new Callable<Map<String, Object>>() {
                    @Override
                    public Map<String, Object> call() {
                        return executeAction(client, action, params);
                    }
                }).get(10, TimeUnit.SECONDS);
            } catch (ExecutionException exception) {
                if (exception.getCause() instanceof LegacyActionException) {
                    throw (LegacyActionException) exception.getCause();
                }
                throw exception;
            }
        }

        private Map<String, Object> executeAction(
            Minecraft client,
            String action,
            JsonObject params
        ) {
            if ("position.get".equals(action)) {
                EntityPlayerSP player = requirePlayer(client);
                Map<String, Object> result = new LinkedHashMap<String, Object>();
                result.put("x", player.posX);
                result.put("y", player.posY);
                result.put("z", player.posZ);
                result.put("yaw", player.rotationYaw);
                result.put("pitch", player.rotationPitch);
                result.put("onGround", player.onGround);
                return result;
            }
            if ("rotation.get".equals(action)) {
                EntityPlayerSP player = requirePlayer(client);
                Map<String, Object> result = new LinkedHashMap<String, Object>();
                result.put("yaw", player.rotationYaw);
                result.put("pitch", player.rotationPitch);
                return result;
            }
            if (action.startsWith("status.")) {
                return status(client, action);
            }
            if ("chat.send".equals(action) || "chat.command".equals(action)) {
                EntityPlayerSP player = requirePlayer(client);
                // The CLI sends chat.command with a "command" param and chat.send with "message".
                String message = "chat.command".equals(action)
                    ? stringValue(params, "command")
                    : stringValue(params, "message");
                if ("chat.command".equals(action) && !message.startsWith("/")) {
                    message = "/" + message;
                }
                player.sendChatMessage(message);
                Map<String, Object> result = new LinkedHashMap<String, Object>();
                result.put("sent", true);
                result.put("message", message);
                return result;
            }
            if ("inventory.get".equals(action)) {
                EntityPlayerSP player = requirePlayer(client);
                List<Map<String, Object>> slots = new ArrayList<Map<String, Object>>();
                for (int slot = 0; slot < player.inventory.getSizeInventory(); slot++) {
                    slots.add(item(player.inventory.getStackInSlot(slot), slot));
                }
                Map<String, Object> result = new LinkedHashMap<String, Object>();
                result.put("slots", slots);
                result.put("selectedSlot", player.inventory.currentItem);
                return result;
            }
            if ("inventory.held".equals(action)) {
                EntityPlayerSP player = requirePlayer(client);
                return item(player.inventory.getCurrentItem(), player.inventory.currentItem);
            }
            if ("inventory.slot".equals(action)) {
                EntityPlayerSP player = requirePlayer(client);
                int slot = intValue(params, "slot", 0);
                if (slot < 0 || slot >= player.inventory.getSizeInventory()) {
                    throw new LegacyActionException("INVALID_PARAMS");
                }
                return item(player.inventory.getStackInSlot(slot), slot);
            }
            if ("inventory.hotbar".equals(action)) {
                EntityPlayerSP player = requirePlayer(client);
                int slot = intValue(params, "slot", 0);
                if (slot < 0 || slot > 8) {
                    throw new LegacyActionException("INVALID_PARAMS");
                }
                player.inventory.currentItem = slot;
                Map<String, Object> result = new LinkedHashMap<String, Object>();
                result.put("selectedSlot", slot);
                return result;
            }
            if ("move.jump".equals(action)) {
                EntityPlayerSP player = requirePlayer(client);
                player.motionY = 0.42D;
                Map<String, Object> result = new LinkedHashMap<String, Object>();
                result.put("jumped", true);
                return result;
            }
            if ("move.sneak".equals(action)) {
                EntityPlayerSP player = requirePlayer(client);
                boolean enabled = booleanValue(params, "enabled", false);
                player.setSneaking(enabled);
                Map<String, Object> result = new LinkedHashMap<String, Object>();
                result.put("sneaking", enabled);
                return result;
            }
            if ("move.sprint".equals(action)) {
                EntityPlayerSP player = requirePlayer(client);
                boolean enabled = booleanValue(params, "enabled", false);
                player.setSprinting(enabled);
                Map<String, Object> result = new LinkedHashMap<String, Object>();
                result.put("sprinting", enabled);
                return result;
            }
            throw new LegacyActionException("INVALID_ACTION");
        }

        private Map<String, Object> status(Minecraft client, String action) {
            EntityPlayerSP player = requirePlayer(client);
            if ("status.health".equals(action)) {
                return health(player);
            }
            if ("status.experience".equals(action)) {
                return experience(player);
            }
            if ("status.world".equals(action)) {
                Map<String, Object> result = new LinkedHashMap<String, Object>();
                result.put("dimension", player.dimension);
                result.put("time", client.world.getWorldTime());
                result.put("raining", client.world.isRaining());
                return result;
            }
            if ("status.gamemode".equals(action)) {
                Map<String, Object> result = new LinkedHashMap<String, Object>();
                result.put("creative", player.isCreative());
                result.put("spectator", player.isSpectator());
                return result;
            }
            if ("status.effects".equals(action)) {
                Map<String, Object> result = new LinkedHashMap<String, Object>();
                result.put("effects", new ArrayList<Object>());
                return result;
            }
            if ("status.all".equals(action)) {
                Map<String, Object> result = new LinkedHashMap<String, Object>();
                result.put("health", health(player));
                result.put("experience", experience(player));
                result.put("position", executeAction(client, "position.get", new JsonObject()));
                result.put("inWorld", true);
                result.put("minecraftVersion", "1.12.2");
                result.put("loader", "forge");
                return result;
            }
            throw new LegacyActionException("INVALID_ACTION");
        }

        private Map<String, Object> health(EntityPlayerSP player) {
            Map<String, Object> result = new LinkedHashMap<String, Object>();
            result.put("health", player.getHealth());
            result.put("maxHealth", player.getMaxHealth());
            result.put("food", player.getFoodStats().getFoodLevel());
            result.put("saturation", player.getFoodStats().getSaturationLevel());
            result.put("dead", player.isDead);
            return result;
        }

        private Map<String, Object> experience(EntityPlayerSP player) {
            Map<String, Object> result = new LinkedHashMap<String, Object>();
            result.put("level", player.experienceLevel);
            result.put("total", player.experienceTotal);
            result.put("progress", player.experience);
            return result;
        }

        private Map<String, Object> item(ItemStack stack, int slot) {
            Map<String, Object> result = new LinkedHashMap<String, Object>();
            result.put("slot", slot);
            boolean empty = stack == null || stack.isEmpty();
            result.put("empty", empty);
            result.put(
                "type",
                empty ? "minecraft:air" : String.valueOf(Item.REGISTRY.getNameForObject(stack.getItem()))
            );
            result.put("count", empty ? 0 : stack.getCount());
            result.put("damage", empty ? 0 : stack.getItemDamage());
            return result;
        }

        private EntityPlayerSP requirePlayer(Minecraft client) {
            if (client.player == null || client.world == null) {
                throw new LegacyActionException("NOT_IN_WORLD");
            }
            return client.player;
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
            if (length > 1024 * 1024) {
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

        private void writeFrame(BufferedOutputStream output, int opcode, byte[] payload)
            throws IOException {
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

        private String stringValue(JsonObject object, String name) {
            JsonElement value = object.get(name);
            return value == null || value.isJsonNull() ? "" : value.getAsString();
        }

        private int intValue(JsonObject object, String name, int fallback) {
            JsonElement value = object.get(name);
            return value == null || value.isJsonNull() ? fallback : value.getAsInt();
        }

        private boolean booleanValue(JsonObject object, String name, boolean fallback) {
            JsonElement value = object.get(name);
            return value == null || value.isJsonNull() ? fallback : value.getAsBoolean();
        }

        private static final class Frame {
            final int opcode;
            final byte[] payload;

            Frame(int opcode, byte[] payload) {
                this.opcode = opcode;
                this.payload = payload;
            }
        }

        private static final class LegacyActionException extends RuntimeException {
            final String code;

            LegacyActionException(String code) {
                super(code);
                this.code = code;
            }
        }
    }
}
