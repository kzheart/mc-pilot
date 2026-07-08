package com.mct.mixin;

import com.mct.core.input.MouseInputBridge;
import net.minecraft.client.MouseHandler;
import net.minecraft.client.input.MouseButtonInfo;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(MouseHandler.class)
public abstract class MouseInvokerBridge implements MouseInputBridge {

    @Invoker("onButton")
    public abstract void mct$onMouseButtonInput(long window, MouseButtonInfo input, int action);

    @Override
    public void mct$onMouseButton(long window, int button, int action, int mods) {
        mct$onMouseButtonInput(window, new MouseButtonInfo(button, mods), action);
    }

    @Override
    @Invoker("onMove")
    public abstract void mct$onCursorPos(long window, double x, double y);

    @Override
    @Invoker("onScroll")
    public abstract void mct$onMouseScroll(long window, double horizontal, double vertical);
}
