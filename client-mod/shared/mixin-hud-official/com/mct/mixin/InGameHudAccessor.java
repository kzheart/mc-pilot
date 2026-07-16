package com.mct.mixin;

import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(targets = {"net.minecraft.client.gui.Gui", "net.minecraft.client.gui.Hud"})
public interface InGameHudAccessor {

    @Accessor("overlayMessageString")
    Component mct$getOverlayMessage();

    @Accessor("title")
    Component mct$getTitle();

    @Accessor("subtitle")
    Component mct$getSubtitle();

    @Accessor("titleFadeInTime")
    int mct$getTitleFadeInTicks();

    @Accessor("titleStayTime")
    int mct$getTitleStayTicks();

    @Accessor("titleFadeOutTime")
    int mct$getTitleFadeOutTicks();
}
