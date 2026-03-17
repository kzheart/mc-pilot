package com.mct.core.handler;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import java.util.Map;
import net.minecraft.client.MinecraftClient;

public final class ActionDispatcher {

    private final ChatHandler chat;
    private final StatusHandler status;
    private final InputHandler input;
    private final MovementHandler movement;
    private final GuiInventoryHandler guiInventory;
    private final SessionHandler session;
    private final WorldHandler world;

    public ActionDispatcher(MinecraftClient client) {
        ClientStateTracker stateTracker = ClientStateTracker.getInstance();
        this.chat = new ChatHandler(client, stateTracker);
        this.status = new StatusHandler(client, stateTracker);
        this.input = new InputHandler(client, stateTracker);
        this.movement = new MovementHandler(client, stateTracker, input);
        this.guiInventory = new GuiInventoryHandler(client, stateTracker);
        this.session = new SessionHandler(client, stateTracker);
        this.world = new WorldHandler(client, stateTracker, movement, input);
    }

    public Map<String, Object> execute(String action, Map<String, Object> params) {
        if (action.startsWith("chat.")) {
            return chat.handle(action, params);
        }
        if (action.startsWith("status.") || action.startsWith("screen.") || action.equals("position.get") || action.equals("rotation.get") || action.equals("wait.perform")) {
            return status.handle(action, params);
        }
        if (action.startsWith("input.")) {
            return input.handle(action, params);
        }
        if (action.startsWith("look.") || action.startsWith("move.")) {
            return movement.handle(action, params);
        }
        if (action.startsWith("inventory.") || action.startsWith("gui.") || action.startsWith("capture.screenshot")) {
            return guiInventory.handle(action, params);
        }
        if (action.startsWith("hud.") || action.startsWith("client.") || action.startsWith("resourcepack.")) {
            return session.handle(action, params);
        }
        if (action.startsWith("combat.") || action.startsWith("sign.") || action.startsWith("book.") || action.startsWith("block.") || action.startsWith("entity.") || action.startsWith("craft.")) {
            return world.handle(action, params);
        }
        throw new ActionException("INVALID_ACTION");
    }
}
