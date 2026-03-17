package com.mct.mixin;

import net.minecraft.client.gui.hud.InGameHud;
import net.minecraft.text.Text;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(InGameHud.class)
public interface InGameHudAccessor {

    @Accessor("overlayMessage")
    Text mct$getOverlayMessage();

    @Accessor("title")
    Text mct$getTitle();

    @Accessor("subtitle")
    Text mct$getSubtitle();

    @Accessor("titleFadeInTicks")
    int mct$getTitleFadeInTicks();

    @Accessor("titleStayTicks")
    int mct$getTitleStayTicks();

    @Accessor("titleFadeOutTicks")
    int mct$getTitleFadeOutTicks();
}
