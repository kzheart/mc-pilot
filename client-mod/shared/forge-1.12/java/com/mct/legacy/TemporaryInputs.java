package com.mct.legacy;

import com.mct.core.concurrent.TemporaryInputLeases;
import com.mct.core.concurrent.TemporaryInputLeases.Scope;
import java.util.concurrent.RejectedExecutionException;
import net.minecraft.client.Minecraft;
import net.minecraft.client.settings.KeyBinding;
import org.lwjgl.input.Keyboard;

/** Thin legacy physical-input adapter; ownership and retained cleanup are shared. */
final class TemporaryInputs {
    static final TemporaryInputLeases LEASES = TemporaryInputLeases.getInstance();
    static final java.util.Set<String> heldNames = java.util.Collections.synchronizedSet(new java.util.LinkedHashSet<String>());
    private static final java.util.Map<String, Integer> nameCodes = new java.util.LinkedHashMap<>();
    private TemporaryInputs() {}

    static void recordName(String name, int code, boolean held) {
        if (held) { heldNames.add(name); nameCodes.put(name, code); }
        else { heldNames.remove(name); nameCodes.remove(name); }
    }

    static void setKeyState(int code, boolean held) {
        KeyBinding.setKeyBindState(code, held);
        if (held) return;
        java.util.Iterator<java.util.Map.Entry<String, Integer>> names = nameCodes.entrySet().iterator();
        while (names.hasNext()) {
            java.util.Map.Entry<String, Integer> name = names.next();
            if (name.getValue() == code) { heldNames.remove(name.getKey()); names.remove(); }
        }
    }

    static Scope open() {
        try { return LEASES.openScope(); }
        catch (RejectedExecutionException full) { throw new LegacyActionException("CLIENT_BUSY"); }
    }

    static void close(Scope scope) {
        scope.close();
        if (!Thread.currentThread().isInterrupted()) MainThread.call(() -> { LEASES.drainClosed(); return true; });
    }

    static String key(int code) { return code < 0 ? "mouse:" + (code + 100) : "key:" + code; }

    static boolean held(int code) {
        for (KeyBinding binding : Minecraft.getMinecraft().gameSettings.keyBindings) {
            if (binding.getKeyCode() == code && binding.isKeyDown()) return true;
        }
        return code < 0 ? org.lwjgl.input.Mouse.isButtonDown(code + 100) : code > 0 && Keyboard.isKeyDown(code);
    }

    static void acquire(Scope scope, int code) {
        MainThread.call(() -> {
            try {
                if (!LEASES.acquire(scope, key(code), () -> held(code), down -> setKeyState(code, down)))
                    throw new LegacyActionException("INTERNAL_ERROR", "temporary input canceled");
            } catch (RejectedExecutionException full) { throw new LegacyActionException("CLIENT_BUSY"); }
            return true;
        });
    }

    static void persistent(int code, boolean down) {
        LEASES.persistent(key(code), down, value -> setKeyState(code, value));
    }
}
