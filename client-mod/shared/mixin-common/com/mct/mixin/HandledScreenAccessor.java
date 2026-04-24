package com.mct.mixin;

import net.minecraft.client.gui.screen.ingame.HandledScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(HandledScreen.class)
public interface HandledScreenAccessor {

    @Accessor("x")
    int mct$getX();

    @Accessor("y")
    int mct$getY();

    @Accessor("backgroundWidth")
    int mct$getBackgroundWidth();

    @Accessor("backgroundHeight")
    int mct$getBackgroundHeight();

    @Accessor("titleX")
    int mct$getTitleX();

    @Accessor("titleY")
    int mct$getTitleY();

    @Accessor("playerInventoryTitleX")
    int mct$getPlayerInventoryTitleX();

    @Accessor("playerInventoryTitleY")
    int mct$getPlayerInventoryTitleY();
}
