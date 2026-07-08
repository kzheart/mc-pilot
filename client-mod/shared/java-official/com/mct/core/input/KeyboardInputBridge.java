package com.mct.core.input;

public interface KeyboardInputBridge {
    void mct$onChar(long window, int codePoint, int modifiers);

    void mct$onKey(long window, int keyCode, int scancode, int action, int modifiers);
}
