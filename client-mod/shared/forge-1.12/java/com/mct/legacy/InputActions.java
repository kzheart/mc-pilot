package com.mct.legacy;

import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import net.minecraft.client.gui.GuiScreen;
import net.minecraft.client.gui.ScaledResolution;
import net.minecraft.client.settings.KeyBinding;
import org.lwjgl.input.Keyboard;
import org.lwjgl.input.Mouse;

/**
 * input.* — LWJGL2 has no event injection, so GUI interaction goes through the
 * protected GuiScreen handlers (mouseClicked/keyTyped/...) via reflection, and
 * gameplay keys go through KeyBinding state.
 */
public final class InputActions extends LegacyActions {

    private final Set<String> heldKeys = Collections.synchronizedSet(new LinkedHashSet<String>());

    @Override
    public Map<String, Object> handle(String action, JsonObject params) {
        if ("input.click".equals(action)) {
            return inputClick(params, 1);
        }
        if ("input.double-click".equals(action)) {
            return inputClick(params, 2);
        }
        if ("input.mouse-move".equals(action)) {
            return inputMouseMove(params);
        }
        if ("input.drag".equals(action)) {
            return inputDrag(params);
        }
        if ("input.mouse-pos".equals(action)) {
            return onClient(this::mousePosition);
        }
        if ("input.scroll".equals(action)) {
            throw new LegacyActionException("INVALID_STATE");
        }
        if ("input.type".equals(action)) {
            return inputType(params);
        }
        if ("input.key-press".equals(action)) {
            return inputKeyPress(params);
        }
        if ("input.key-hold".equals(action)) {
            return inputKeyHold(params);
        }
        if ("input.key-down".equals(action)) {
            return inputKeyState(params, true);
        }
        if ("input.key-up".equals(action)) {
            return inputKeyState(params, false);
        }
        if ("input.key-combo".equals(action)) {
            return inputKeyCombo(params);
        }
        if ("input.keys-down".equals(action)) {
            return map("keys", snapshotHeldKeys());
        }
        throw new LegacyActionException("INVALID_ACTION");
    }

    private Map<String, Object> inputClick(JsonObject params, int count) {
        int x = Params.requireInt(params, "x");
        int y = Params.requireInt(params, "y");
        String button = normalizeMouseButton(Params.string(params, "button", "left"));
        for (int index = 0; index < count; index++) {
            clickAt(x, y, button);
            if (index + 1 < count) {
                MainThread.sleep(100L);
            }
        }
        Map<String, Object> result = map("clicked", true, "button", button, "mouse", onClient(this::mousePosition));
        if (count == 2) {
            result.put("count", 2);
        }
        return result;
    }

    private void clickAt(int scaledX, int scaledY, String button) {
        onClient(() -> {
            GuiScreen screen = client.currentScreen;
            if (screen != null) {
                moveHardwareCursor(scaledX, scaledY);
                int mouseButton = mouseButtonIndex(button);
                Reflect.invoke(
                    screen, GuiScreen.class,
                    new Class<?>[] {int.class, int.class, int.class},
                    new Object[] {scaledX, scaledY, mouseButton},
                    "mouseClicked", "func_73864_a"
                );
                Reflect.invoke(
                    screen, GuiScreen.class,
                    new Class<?>[] {int.class, int.class, int.class},
                    new Object[] {scaledX, scaledY, mouseButton},
                    "mouseReleased", "func_146286_b"
                );
                return true;
            }
            if ("left".equals(button)) {
                Reflect.invoke(client, client.getClass(), new Class<?>[0], new Object[0], "clickMouse", "func_147116_af");
            } else if ("right".equals(button)) {
                Reflect.invoke(client, client.getClass(), new Class<?>[0], new Object[0], "rightClickMouse", "func_147121_ag");
            } else {
                throw new LegacyActionException("INVALID_PARAMS");
            }
            return true;
        });
    }

    private Map<String, Object> inputMouseMove(JsonObject params) {
        int x = Params.requireInt(params, "x");
        int y = Params.requireInt(params, "y");
        onClient(() -> {
            moveHardwareCursor(x, y);
            return true;
        });
        Map<String, Object> result = onClient(this::mousePosition);
        result.put("moved", true);
        return result;
    }

    private Map<String, Object> inputDrag(JsonObject params) {
        int fromX = Params.requireInt(params, "fromX");
        int fromY = Params.requireInt(params, "fromY");
        int toX = Params.requireInt(params, "toX");
        int toY = Params.requireInt(params, "toY");
        String button = normalizeMouseButton(Params.string(params, "button", "left"));
        int mouseButton = mouseButtonIndex(button);
        boolean handled = onClient(() -> client.currentScreen != null);
        if (!handled) {
            throw new LegacyActionException("INVALID_STATE");
        }

        onClient(() -> {
            moveHardwareCursor(fromX, fromY);
            Reflect.invoke(
                client.currentScreen, GuiScreen.class,
                new Class<?>[] {int.class, int.class, int.class},
                new Object[] {fromX, fromY, mouseButton},
                "mouseClicked", "func_73864_a"
            );
            return true;
        });
        MainThread.sleep(50L);
        int steps = Math.max(10, (int) Math.ceil(Math.hypot(toX - fromX, toY - fromY) / 8.0D));
        for (int step = 1; step <= steps; step++) {
            double progress = (double) step / (double) steps;
            int nextX = (int) Math.round(fromX + ((toX - fromX) * progress));
            int nextY = (int) Math.round(fromY + ((toY - fromY) * progress));
            onClient(() -> {
                if (client.currentScreen == null) {
                    return false;
                }
                moveHardwareCursor(nextX, nextY);
                Reflect.invoke(
                    client.currentScreen, GuiScreen.class,
                    new Class<?>[] {int.class, int.class, int.class, long.class},
                    new Object[] {nextX, nextY, mouseButton, 25L},
                    "mouseClickMove", "func_146273_a"
                );
                return true;
            });
            MainThread.sleep(25L);
        }
        onClient(() -> {
            if (client.currentScreen != null) {
                Reflect.invoke(
                    client.currentScreen, GuiScreen.class,
                    new Class<?>[] {int.class, int.class, int.class},
                    new Object[] {toX, toY, mouseButton},
                    "mouseReleased", "func_146286_b"
                );
            }
            return true;
        });
        return map(
            "dragged", true,
            "button", button,
            "from", map("x", fromX, "y", fromY),
            "to", map("x", toX, "y", toY)
        );
    }

    private Map<String, Object> inputType(JsonObject params) {
        String text = Params.string(params, "text");
        onClient(() -> {
            GuiScreen screen = client.currentScreen;
            if (screen == null) {
                throw new LegacyActionException("INVALID_STATE");
            }
            for (int index = 0; index < text.length(); index++) {
                char value = text.charAt(index);
                typeChar(screen, value, 0);
            }
            return true;
        });
        return map("typed", true, "text", text);
    }

    private Map<String, Object> inputKeyPress(JsonObject params) {
        String keyName = normalizeKeyName(Params.requireString(params, "key"));
        pressAndRelease(keyName, 100L);
        return map("pressed", true, "key", keyName);
    }

    private Map<String, Object> inputKeyHold(JsonObject params) {
        String keyName = normalizeKeyName(Params.requireString(params, "key"));
        long duration = Math.max(1L, Params.intValue(params, "duration", 100));
        long startedAt = System.currentTimeMillis();
        dispatchKey(keyName, true);
        MainThread.sleep(duration);
        dispatchKey(keyName, false);
        return map("held", true, "key", keyName, "actualDuration", System.currentTimeMillis() - startedAt);
    }

    private Map<String, Object> inputKeyState(JsonObject params, boolean down) {
        String keyName = normalizeKeyName(Params.requireString(params, "key"));
        dispatchKey(keyName, down);
        return map(down ? "down" : "up", true, "key", keyName, "keys", snapshotHeldKeys());
    }

    private Map<String, Object> inputKeyCombo(JsonObject params) {
        List<String> keys = new ArrayList<String>();
        for (String key : Params.stringList(params, "keys")) {
            keys.add(normalizeKeyName(key));
        }
        for (String key : keys) {
            dispatchKey(key, true);
            MainThread.sleep(35L);
        }
        MainThread.sleep(75L);
        for (int index = keys.size() - 1; index >= 0; index--) {
            dispatchKey(keys.get(index), false);
            MainThread.sleep(20L);
        }
        return map("pressed", true, "keys", keys);
    }

    private void pressAndRelease(String keyName, long holdMillis) {
        dispatchKey(keyName, true);
        MainThread.sleep(holdMillis);
        dispatchKey(keyName, false);
        MainThread.sleep(40L);
    }

    private void dispatchKey(String keyName, boolean down) {
        onClient(() -> {
            GuiScreen screen = client.currentScreen;
            if (screen != null) {
                if (down) {
                    typeChar(screen, charForKey(keyName), lwjglKeyCode(keyName));
                }
                return true;
            }
            KeyBinding binding = gameplayBinding(keyName);
            int keyCode = binding != null ? binding.getKeyCode() : lwjglKeyCode(keyName);
            if (keyCode <= 0) {
                throw new LegacyActionException("INVALID_PARAMS");
            }
            if (down) {
                KeyBinding.onTick(keyCode);
            }
            KeyBinding.setKeyBindState(keyCode, down);
            return true;
        });
        if (down) {
            heldKeys.add(keyName);
        } else {
            heldKeys.remove(keyName);
        }
    }

    private void typeChar(GuiScreen screen, char value, int keyCode) {
        Reflect.invoke(
            screen, GuiScreen.class,
            new Class<?>[] {char.class, int.class},
            new Object[] {value, keyCode},
            "keyTyped", "func_73869_a"
        );
    }

    private KeyBinding gameplayBinding(String keyName) {
        if ("inventory".equals(keyName)) {
            return client.gameSettings.keyBindInventory;
        }
        if ("drop".equals(keyName)) {
            return client.gameSettings.keyBindDrop;
        }
        if ("sprint".equals(keyName)) {
            return client.gameSettings.keyBindSprint;
        }
        if ("sneak".equals(keyName)) {
            return client.gameSettings.keyBindSneak;
        }
        return null;
    }

    private char charForKey(String keyName) {
        if (keyName.length() == 1) {
            return keyName.charAt(0);
        }
        if ("space".equals(keyName)) {
            return ' ';
        }
        if ("enter".equals(keyName)) {
            return '\r';
        }
        if ("backspace".equals(keyName)) {
            return '\b';
        }
        if ("tab".equals(keyName)) {
            return '\t';
        }
        return '\0';
    }

    private int lwjglKeyCode(String keyName) {
        if (keyName.length() == 1) {
            int index = Keyboard.getKeyIndex(keyName.toUpperCase(Locale.ROOT));
            return index != Keyboard.KEY_NONE ? index : 0;
        }
        if ("space".equals(keyName)) {
            return Keyboard.KEY_SPACE;
        }
        if ("shift".equals(keyName)) {
            return Keyboard.KEY_LSHIFT;
        }
        if ("ctrl".equals(keyName) || "control".equals(keyName)) {
            return Keyboard.KEY_LCONTROL;
        }
        if ("alt".equals(keyName)) {
            return Keyboard.KEY_LMENU;
        }
        if ("tab".equals(keyName)) {
            return Keyboard.KEY_TAB;
        }
        if ("escape".equals(keyName) || "esc".equals(keyName)) {
            return Keyboard.KEY_ESCAPE;
        }
        if ("enter".equals(keyName) || "return".equals(keyName)) {
            return Keyboard.KEY_RETURN;
        }
        if ("backspace".equals(keyName)) {
            return Keyboard.KEY_BACK;
        }
        if ("delete".equals(keyName)) {
            return Keyboard.KEY_DELETE;
        }
        if ("up".equals(keyName)) {
            return Keyboard.KEY_UP;
        }
        if ("down".equals(keyName)) {
            return Keyboard.KEY_DOWN;
        }
        if ("left".equals(keyName)) {
            return Keyboard.KEY_LEFT;
        }
        if ("right".equals(keyName)) {
            return Keyboard.KEY_RIGHT;
        }
        if (keyName.startsWith("f") && keyName.length() <= 3) {
            try {
                int functionIndex = Integer.parseInt(keyName.substring(1));
                if (functionIndex >= 1 && functionIndex <= 12) {
                    return Keyboard.getKeyIndex("F" + functionIndex);
                }
            } catch (NumberFormatException ignored) {
            }
        }
        return 0;
    }

    private void moveHardwareCursor(int scaledX, int scaledY) {
        ScaledResolution resolution = new ScaledResolution(client);
        int rawX = scaledX * client.displayWidth / resolution.getScaledWidth();
        int rawYFromTop = scaledY * client.displayHeight / resolution.getScaledHeight();
        Mouse.setCursorPosition(rawX, client.displayHeight - 1 - rawYFromTop);
    }

    private Map<String, Object> mousePosition() {
        ScaledResolution resolution = new ScaledResolution(client);
        double x = (double) Mouse.getX() * resolution.getScaledWidth() / client.displayWidth;
        double y = (double) (client.displayHeight - 1 - Mouse.getY()) * resolution.getScaledHeight() / client.displayHeight;
        return map("x", x, "y", y);
    }

    private List<String> snapshotHeldKeys() {
        synchronized (heldKeys) {
            List<String> keys = new ArrayList<String>(heldKeys);
            Collections.sort(keys);
            return keys;
        }
    }

    private String normalizeKeyName(String value) {
        return value.toLowerCase(Locale.ROOT).trim();
    }

    private String normalizeMouseButton(String button) {
        String normalized = button.toLowerCase(Locale.ROOT).trim();
        if ("left".equals(normalized) || "attack".equals(normalized)) {
            return "left";
        }
        if ("right".equals(normalized) || "use".equals(normalized)) {
            return "right";
        }
        if ("middle".equals(normalized) || "pick".equals(normalized)) {
            return "middle";
        }
        throw new LegacyActionException("INVALID_PARAMS");
    }

    private int mouseButtonIndex(String button) {
        if ("left".equals(button)) {
            return 0;
        }
        if ("right".equals(button)) {
            return 1;
        }
        return 2;
    }
}
