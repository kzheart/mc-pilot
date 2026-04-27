package com.mct.version.invoker;

import com.mct.mixin.KeyboardInvokerBridge;
import net.minecraft.client.input.CharInput;
import net.minecraft.client.input.KeyInput;

public interface KeyboardInvoker {

    default void mct$onChar(long window, int codePoint, int modifiers) {
        ((KeyboardInvokerBridge) this).mct$onCharInput(window, new CharInput(codePoint, modifiers));
    }

    default void mct$onKey(long window, int keyCode, int scancode, int action, int modifiers) {
        ((KeyboardInvokerBridge) this).mct$onKeyInput(window, action, new KeyInput(keyCode, scancode, modifiers));
    }
}
