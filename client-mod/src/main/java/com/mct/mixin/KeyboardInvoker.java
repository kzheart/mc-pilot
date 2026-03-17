package com.mct.mixin;

import net.minecraft.client.Keyboard;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(Keyboard.class)
public interface KeyboardInvoker {

    @Invoker("onChar")
    void mct$onChar(long window, int codePoint, int modifiers);
}
