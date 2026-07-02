package com.mct.mixin;

import com.mct.core.input.KeyboardInputBridge;
import net.minecraft.client.Keyboard;
import net.minecraft.client.input.CharInput;
import net.minecraft.client.input.KeyInput;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(Keyboard.class)
public abstract class KeyboardInvokerBridge implements KeyboardInputBridge {

    @Invoker("onChar")
    public abstract void mct$onCharInput(long window, CharInput input);

    @Invoker("onKey")
    public abstract void mct$onKeyInput(long window, int action, KeyInput input);

    @Override
    public void mct$onChar(long window, int codePoint, int modifiers) {
        mct$onCharInput(window, new CharInput(codePoint, modifiers));
    }

    @Override
    public void mct$onKey(long window, int keyCode, int scancode, int action, int modifiers) {
        mct$onKeyInput(window, action, new KeyInput(keyCode, scancode, modifiers));
    }
}
