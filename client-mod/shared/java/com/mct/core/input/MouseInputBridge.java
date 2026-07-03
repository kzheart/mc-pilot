package com.mct.core.input;

public interface MouseInputBridge {
    void mct$onMouseButton(long window, int button, int action, int mods);

    void mct$onMouseScroll(long window, double horizontal, double vertical);

    void mct$onCursorPos(long window, double x, double y);
}
