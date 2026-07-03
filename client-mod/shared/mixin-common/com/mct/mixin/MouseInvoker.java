package com.mct.mixin;

import com.mct.core.input.MouseInputBridge;
import net.minecraft.client.Mouse;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(Mouse.class)
public interface MouseInvoker extends MouseInputBridge {

    @Override
    @Invoker("onMouseButton")
    void mct$onMouseButton(long window, int button, int action, int mods);

    @Override
    @Invoker("onMouseScroll")
    void mct$onMouseScroll(long window, double horizontal, double vertical);

    @Override
    @Invoker("onCursorPos")
    void mct$onCursorPos(long window, double x, double y);
}
