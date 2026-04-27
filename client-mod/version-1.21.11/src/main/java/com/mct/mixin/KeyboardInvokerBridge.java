package com.mct.mixin;

import com.mct.version.invoker.KeyboardInvoker;
import net.minecraft.client.Keyboard;
import net.minecraft.client.input.CharInput;
import net.minecraft.client.input.KeyInput;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(Keyboard.class)
public interface KeyboardInvokerBridge extends KeyboardInvoker {

    @Invoker("onChar")
    void mct$onCharInput(long window, CharInput input);

    @Invoker("onKey")
    void mct$onKeyInput(long window, int action, KeyInput input);
}
