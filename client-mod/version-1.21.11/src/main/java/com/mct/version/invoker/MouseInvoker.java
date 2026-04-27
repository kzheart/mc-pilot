package com.mct.version.invoker;

import com.mct.mixin.MouseInvokerBridge;
import net.minecraft.client.input.MouseInput;

public interface MouseInvoker {

    default void mct$onMouseButton(long window, int button, int action, int mods) {
        ((MouseInvokerBridge) this).mct$onMouseButtonInput(window, new MouseInput(button, mods), action);
    }

    void mct$onMouseScroll(long window, double horizontal, double vertical);

    void mct$onCursorPos(long window, double x, double y);
}
