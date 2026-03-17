package com.mct.mixin;

import net.minecraft.client.gui.screen.ingame.SignEditScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(SignEditScreen.class)
public interface AbstractSignEditScreenAccessor {

    @Accessor("currentRow")
    void mct$setCurrentRow(int row);

    @Accessor("text")
    String[] mct$getText();
}
