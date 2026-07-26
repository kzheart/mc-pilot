package com.mct.legacy;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiIngame;
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent;
import net.minecraftforge.fml.common.gameevent.TickEvent;

/**
 * GuiIngame clears its title fields when the display timer ends; poll them each
 * tick so hud.title keeps returning the last shown title like the modern tracker.
 */
public final class TitleTracker {

    private volatile String title = "";
    private volatile String subtitle = "";

    @SubscribeEvent
    public void onClientTick(TickEvent.ClientTickEvent event) {
        if (event.phase != TickEvent.Phase.END) {
            return;
        }
        GuiIngame ingame = Minecraft.getMinecraft().ingameGUI;
        if (ingame == null) {
            return;
        }
        try {
            String currentTitle = stringField(ingame, "displayedTitle", "field_175201_x");
            String currentSubtitle = stringField(ingame, "displayedSubTitle", "field_175200_y");
            if (!currentTitle.isEmpty()) {
                title = currentTitle;
                subtitle = currentSubtitle;
            } else if (!currentSubtitle.isEmpty()) {
                subtitle = currentSubtitle;
            }
        } catch (RuntimeException ignored) {
        }
    }

    private String stringField(GuiIngame ingame, String mcpName, String srgName) {
        Object value = Reflect.get(ingame, GuiIngame.class, mcpName, srgName);
        return value != null ? String.valueOf(value).replaceAll("§.", "") : "";
    }

    public String title() {
        return title;
    }

    public String subtitle() {
        return subtitle;
    }
}
