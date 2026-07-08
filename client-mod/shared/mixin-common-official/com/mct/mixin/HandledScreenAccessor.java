package com.mct.mixin;

import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(AbstractContainerScreen.class)
public interface HandledScreenAccessor {

    @Accessor("leftPos")
    int mct$getX();

    @Accessor("topPos")
    int mct$getY();

    @Accessor("imageWidth")
    int mct$getBackgroundWidth();

    @Accessor("imageHeight")
    int mct$getBackgroundHeight();

    @Accessor("titleLabelX")
    int mct$getTitleX();

    @Accessor("titleLabelY")
    int mct$getTitleY();

    @Accessor("inventoryLabelX")
    int mct$getPlayerInventoryTitleX();

    @Accessor("inventoryLabelY")
    int mct$getPlayerInventoryTitleY();
}
