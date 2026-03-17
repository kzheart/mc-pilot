package com.mct.mixin;

import net.minecraft.client.gui.screen.ingame.AbstractSignEditScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(AbstractSignEditScreen.class)
public interface AbstractSignEditScreenAccessor {

    @Accessor("currentRow")
    void mct$setCurrentRow(int row);

    @Invoker("setCurrentRowMessage")
    void mct$setCurrentRowMessage(String message);
}
