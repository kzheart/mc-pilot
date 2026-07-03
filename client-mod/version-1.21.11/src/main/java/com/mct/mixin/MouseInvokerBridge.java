package com.mct.mixin;

import com.mct.core.input.MouseInputBridge;
import net.minecraft.client.Mouse;
import net.minecraft.client.input.MouseInput;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(Mouse.class)
public abstract class MouseInvokerBridge implements MouseInputBridge {

    @Invoker("onMouseButton")
    public abstract void mct$onMouseButtonInput(long window, MouseInput input, int action);

    @Override
    public void mct$onMouseButton(long window, int button, int action, int mods) {
        mct$onMouseButtonInput(window, new MouseInput(button, mods), action);
    }

    @Override
    @Invoker("onCursorPos")
    public abstract void mct$onCursorPos(long window, double x, double y);

    @Override
    @Invoker("onMouseScroll")
    public abstract void mct$onMouseScroll(long window, double horizontal, double vertical);
}
