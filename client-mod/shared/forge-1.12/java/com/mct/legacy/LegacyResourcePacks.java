package com.mct.legacy;

import com.mct.core.resourcepack.ResourcePackLifecycle;
import com.mct.core.resourcepack.ResourcePackPolicy;
import io.netty.channel.ChannelDuplexHandler;
import io.netty.channel.ChannelHandlerContext;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiYesNo;
import net.minecraft.client.gui.GuiYesNoCallback;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.ServerList;
import net.minecraft.network.NetworkManager;
import net.minecraft.network.play.client.CPacketResourcePackStatus;
import net.minecraft.network.play.server.SPacketResourcePackSend;
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent;
import net.minecraftforge.fml.common.network.FMLNetworkEvent;

/** Apply connection policy; legacy protocol completion does not prove resource application. */
public final class LegacyResourcePacks {
    private final Minecraft client = Minecraft.getMinecraft();
    private final ResourcePackLifecycle lifecycle = new ResourcePackLifecycle();
    private final Map<String, String> overrides = new HashMap<String, String>();
    private volatile NetworkManager connection;
    private GuiYesNo prompt;
    private volatile String offerId;
    private GuiYesNoCallback promptCallback;
    private String policy = "accept";
    private int sequence;

    public void setOverride(String address, String value) {
        try {
            String policy = ResourcePackPolicy.parse(value);
            if (policy != null) overrides.put(key(address), policy);
        } catch (IllegalArgumentException exception) {
            throw new LegacyActionException("INVALID_PARAMS");
        }
    }

    public ServerData connectionInfo(String address) {
        ServerData current = client.getCurrentServerData();
        if (current != null && key(current.serverIP).equals(key(address))) return current;
        ServerList list = new ServerList(client);
        list.loadServerList();
        for (int i = 0; i < list.countServers(); i++) {
            ServerData saved = list.getServerData(i);
            if (key(saved.serverIP).equals(key(address))) return saved;
        }
        return new ServerData("mct", address, false);
    }

    private void prepare() {
        ServerData current = client.getCurrentServerData();
        policy = "prompt";
        if (current == null && connection != null) {
            String address = System.getenv("MCT_CLIENT_SERVER");
            if (address == null || address.trim().isEmpty()) {
                java.net.SocketAddress remote = connection.getRemoteAddress();
                if (remote instanceof java.net.InetSocketAddress) {
                    java.net.InetSocketAddress socket = (java.net.InetSocketAddress) remote;
                    address = socket.getHostString() + ":" + socket.getPort();
                }
            }
            if (address != null && !address.trim().isEmpty()) {
                current = connectionInfo(address);
                client.setServerData(current);
            }
        }
        if (current != null) {
            ServerData saved = connectionInfo(current.serverIP);
            // A quick-connect entry is not necessarily the saved server entry.
            ServerList list = new ServerList(client);
            list.loadServerList();
            for (int i = 0; i < list.countServers(); i++) {
                ServerData entry = list.getServerData(i);
                if (key(entry.serverIP).equals(key(current.serverIP))
                        && entry.getResourceMode() == ServerData.ServerResourceMode.DISABLED) saved = entry;
            }
            try {
                policy = ResourcePackPolicy.resolve(overrides.get(key(current.serverIP)),
                    System.getenv("MCT_CLIENT_RESOURCE_PACK_POLICY"),
                    saved.getResourceMode() == ServerData.ServerResourceMode.DISABLED);
            } catch (IllegalArgumentException ignored) {
                // Invalid external configuration must not silently allow a download.
            }
            current.setResourceMode("accept".equals(policy) ? ServerData.ServerResourceMode.ENABLED
                : "reject".equals(policy) ? ServerData.ServerResourceMode.DISABLED : ServerData.ServerResourceMode.PROMPT);
        }
        prompt = null;
        promptCallback = null;
        offerId = null;
        sequence = 0;
        lifecycle.reset(policy);
        // 1.12 does not expose an observable end-to-end reload result here.
    }

    @SubscribeEvent
    public void connected(FMLNetworkEvent.ClientConnectedToServerEvent event) {
        final NetworkManager manager = event.getManager();
        // Policy preparation and offers enter the same main-thread task queue.
        // Resource-pack packets are consumed here; other packets are untouched.
        client.addScheduledTask(() -> {
            connection = manager;
            prepare();
        });
        manager.channel().pipeline().addBefore("packet_handler", "mct_resource_packs", new ChannelDuplexHandler() {
            @Override
            public void channelRead(ChannelHandlerContext context, Object message) throws Exception {
                if (!(message instanceof SPacketResourcePackSend)) {
                    super.channelRead(context, message);
                    return;
                }
                client.addScheduledTask(() -> {
                    if (connection == manager && manager.isChannelOpen()) offer(manager, (SPacketResourcePackSend) message);
                });
            }
        });
    }

    private void offer(final NetworkManager manager, final SPacketResourcePackSend packet) {
        final String id = "legacy-" + (++sequence);
        offerId = id;
        prompt = null;
        promptCallback = null;
        lifecycle.removeAll(); // 1.12 supports one server pack, with no protocol UUID.
        lifecycle.offered(id, false); // 1.12 has no required-pack flag.
        final String url = packet.getURL();
        try {
            LegacyResourcePackUrls.validate(url);
        } catch (Exception invalid) {
            report(manager, id, CPacketResourcePackStatus.Action.FAILED_DOWNLOAD);
            return;
        }
        if ("reject".equals(policy)) {
            report(manager, id, CPacketResourcePackStatus.Action.DECLINED);
        } else if ("prompt".equals(policy)) {
            promptCallback = (accept, buttonId) -> {
                if (connection != manager || !id.equals(offerId)) return;
                prompt = null;
                promptCallback = null;
                lifecycle.prompt(false);
                client.displayGuiScreen(null);
                // Vanilla remembers the decision for subsequent offers on this
                // connection. Keep lifecycle.policy as the originally requested
                // policy, while this decision controls later offers.
                policy = accept ? "accept" : "reject";
                ServerData server = client.getCurrentServerData();
                if (server != null) {
                    server.setResourceMode(accept ? ServerData.ServerResourceMode.ENABLED : ServerData.ServerResourceMode.DISABLED);
                    ServerList.saveSingleServer(server);
                }
                if (accept) download(manager, id, packet);
                else report(manager, id, CPacketResourcePackStatus.Action.DECLINED);
            };
            prompt = new GuiYesNo(promptCallback,
                net.minecraft.client.resources.I18n.format("multiplayer.texturePrompt.line1"),
                net.minecraft.client.resources.I18n.format("multiplayer.texturePrompt.line2"), 0);
            lifecycle.prompt(true);
            client.displayGuiScreen(prompt);
        } else {
            download(manager, id, packet);
        }
    }

    private void download(final NetworkManager manager, final String id, SPacketResourcePackSend packet) {
        try {
            com.google.common.util.concurrent.ListenableFuture<?> future;
            if (packet.getURL().startsWith("level://")) {
                java.io.File pack = LegacyResourcePackUrls.localPack(client.gameDir, packet.getURL());
                report(manager, id, CPacketResourcePackStatus.Action.ACCEPTED);
                future = client.getResourcePackRepository().setServerResourcePack(pack);
            } else {
                report(manager, id, CPacketResourcePackStatus.Action.ACCEPTED);
                future = client.getResourcePackRepository().downloadResourcePack(packet.getURL(), packet.getHash());
            }
            // Vanilla returns the raw HTTP future on a cache miss. Even a direct
            // reload future can succeed after Minecraft falls back to defaults.
            // Preserve vanilla wire behavior without claiming verified application.
            com.google.common.util.concurrent.Futures.addCallback(future,
                new com.google.common.util.concurrent.FutureCallback<Object>() {
                    @Override public void onSuccess(Object result) {
                        completeUnverified(manager, id);
                    }
                    @Override public void onFailure(Throwable failure) {
                        report(manager, id, CPacketResourcePackStatus.Action.FAILED_DOWNLOAD);
                    }
                });
        } catch (Exception failure) {
            report(manager, id, CPacketResourcePackStatus.Action.FAILED_DOWNLOAD);
        }
    }

    private void report(NetworkManager manager, String id, CPacketResourcePackStatus.Action status) {
        // Serialize the identity check and state update with connection resets.
        // Otherwise an old completion could race a new connection's first offer.
        client.addScheduledTask(() -> {
            if (connection != manager || !id.equals(offerId)) return;
            lifecycle.status(id, status.name());
            if (manager.isChannelOpen()) manager.sendPacket(new CPacketResourcePackStatus(status));
        });
    }

    private void completeUnverified(NetworkManager manager, String id) {
        client.addScheduledTask(() -> {
            if (connection != manager || !id.equals(offerId)) return;
            if (!manager.isChannelOpen()) {
                lifecycle.status(id, "FAILED_DOWNLOAD");
                return;
            }
            lifecycle.unverified(id);
            // This is vanilla 1.12's protocol acknowledgment, not local evidence
            // that a ZIP was valid or that its textures survived resource reload.
            manager.sendPacket(new CPacketResourcePackStatus(CPacketResourcePackStatus.Action.SUCCESSFULLY_LOADED));
        });
    }

    @SubscribeEvent
    public void disconnected(FMLNetworkEvent.ClientDisconnectionFromServerEvent event) {
        final NetworkManager manager = event.getManager();
        client.addScheduledTask(() -> {
            if (connection != manager) return;
            if (offerId != null && Boolean.TRUE.equals(lifecycle.snapshot().get("pending"))) {
                lifecycle.status(offerId, "FAILED_DOWNLOAD");
            }
            lifecycle.prompt(false);
            prompt = null;
            promptCallback = null;
            connection = null;
        });
    }

    public Map<String, Object> status() {
        lifecycle.prompt(prompt != null && client.currentScreen == prompt);
        return lifecycle.snapshot();
    }

    public Map<String, Object> answer(boolean accept) {
        // Only the exact prompt and callback created for this offer can be answered.
        if (prompt != null && client.currentScreen == prompt && promptCallback != null
                && connection != null && connection.isChannelOpen()) {
            GuiYesNoCallback callback = promptCallback;
            callback.confirmClicked(accept, 0);
        }
        return status();
    }

    private static String key(String address) {
        net.minecraft.client.multiplayer.ServerAddress parsed = net.minecraft.client.multiplayer.ServerAddress.fromString(address.trim());
        return parsed.getIP().toLowerCase(Locale.ROOT) + ":" + parsed.getPort();
    }
}
