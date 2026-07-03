package com.mct.mixin;

import com.mct.core.input.KeyboardInputBridge;
import net.minecraft.client.Keyboard;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(Keyboard.class)
public interface KeyboardInvoker extends KeyboardInputBridge {

    @Override
    @Invoker("onChar")
    void mct$onChar(long window, int codePoint, int modifiers);

    @Override
    @Invoker("onKey")
    void mct$onKey(long window, int keyCode, int scancode, int action, int modifiers);
}
