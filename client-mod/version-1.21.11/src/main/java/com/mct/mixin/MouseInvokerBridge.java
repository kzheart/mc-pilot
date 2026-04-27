package com.mct.mixin;

import com.mct.version.invoker.MouseInvoker;
import net.minecraft.client.Mouse;
import net.minecraft.client.input.MouseInput;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(Mouse.class)
public interface MouseInvokerBridge extends MouseInvoker {

    @Invoker("onMouseButton")
    void mct$onMouseButtonInput(long window, MouseInput input, int action);

    @Override
    @Invoker("onMouseScroll")
    void mct$onMouseScroll(long window, double horizontal, double vertical);

    @Override
    @Invoker("onCursorPos")
    void mct$onCursorPos(long window, double x, double y);
}
