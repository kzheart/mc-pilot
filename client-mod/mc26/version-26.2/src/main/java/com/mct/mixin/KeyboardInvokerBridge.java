package com.mct.mixin;

import com.mct.core.input.KeyboardInputBridge;
import net.minecraft.client.KeyboardHandler;
import net.minecraft.client.input.CharacterEvent;
import net.minecraft.client.input.KeyEvent;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(KeyboardHandler.class)
public abstract class KeyboardInvokerBridge implements KeyboardInputBridge {

    @Invoker("charTyped")
    public abstract void mct$onCharInput(long window, CharacterEvent input);

    @Invoker("keyPress")
    public abstract void mct$onKeyInput(long window, int action, KeyEvent input);

    @Override
    public void mct$onChar(long window, int codePoint, int modifiers) {
        mct$onCharInput(window, new CharacterEvent(codePoint));
    }

    @Override
    public void mct$onKey(long window, int keyCode, int scancode, int action, int modifiers) {
        mct$onKeyInput(window, action, new KeyEvent(keyCode, scancode, modifiers));
    }
}
