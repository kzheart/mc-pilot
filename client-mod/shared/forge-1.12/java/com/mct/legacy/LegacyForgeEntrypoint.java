package com.mct.legacy;

import net.minecraftforge.common.MinecraftForge;
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
    private static ChatRecorder chatRecorder;
    private static TitleTracker titleTracker;

    public static ChatRecorder chatRecorder() {
        return chatRecorder;
    }

    public static TitleTracker titleTracker() {
        return titleTracker;
    }

    @Mod.EventHandler
    public void initialize(FMLInitializationEvent event) {
        if (server != null) {
            return;
        }
        chatRecorder = new ChatRecorder();
        MinecraftForge.EVENT_BUS.register(chatRecorder);
        titleTracker = new TitleTracker();
        MinecraftForge.EVENT_BUS.register(titleTracker);

        MovementActions movement = new MovementActions();
        ActionRouter router = new ActionRouter();
        router.register(new ChatActions(chatRecorder), "chat.");
        router.register(new StatusActions(), "status.", "screen.", "position.get", "rotation.get", "wait.perform");
        router.register(new InputActions(), "input.");
        router.register(movement, "look.", "move.");
        router.register(new InventoryGuiActions(), "inventory.", "gui.", "capture.screenshot");
        router.register(new SessionActions(), "hud.", "client.", "resourcepack.");
        router.register(new WorldActions(), "block.");
        router.register(new SignBookActions(), "sign.", "book.");
        router.register(new EntityCombatActions(movement), "entity.", "combat.");
        router.register(new CraftActions(), "craft.");

        int port = Integer.parseInt(environment("MCT_CLIENT_WS_PORT", "25560"));
        server = new LegacyWebSocketServer(port, router);
        server.start();
    }

    private static String environment(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isEmpty() ? fallback : value;
    }
}
