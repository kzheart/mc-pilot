package com.mct.core.handler;

import static com.mct.core.util.ParamHelper.*;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.mixin.KeyBindingAccessor;
import com.mct.mixin.KeyboardInvoker;
import com.mct.mixin.MouseInvoker;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import org.jetbrains.annotations.Nullable;
import org.lwjgl.glfw.GLFW;

public final class InputHandler extends ActionHandler {

    private final Set<String> heldInputKeys = Collections.synchronizedSet(new LinkedHashSet<>());

    public InputHandler(MinecraftClient client, ClientStateTracker stateTracker) {
        super(client, stateTracker);
    }

    @Override
    public Map<String, Object> handle(String action, Map<String, Object> params) {
        return switch (action) {
            case "input.click" -> inputClick(params);
            case "input.double-click" -> inputDoubleClick(params);
            case "input.mouse-move" -> inputMouseMove(params);
            case "input.drag" -> inputDrag(params);
            case "input.scroll" -> inputScroll(params);
            case "input.key-press" -> inputKeyPress(params);
            case "input.key-hold" -> inputKeyHold(params);
            case "input.key-down" -> inputKeyDown(params);
            case "input.key-up" -> inputKeyUp(params);
            case "input.key-combo" -> inputKeyCombo(params);
            case "input.type" -> inputType(params);
            case "input.mouse-pos" -> runOnClientThread(this::currentMousePosition);
            case "input.keys-down" -> inputKeysDown();
            default -> throw new ActionException("INVALID_ACTION");
        };
    }

    // --- Public helpers used by other handlers ---

    public void moveMouseTo(int scaledX, int scaledY) {
        runOnClientThread(() -> {
            long window = client.getWindow().getHandle();
            double rawX = scaledToRawX(scaledX);
            double rawY = scaledToRawY(scaledY);
            GLFW.glfwSetCursorPos(window, rawX, rawY);
            ((MouseInvoker) client.mouse).mct$onCursorPos(window, rawX, rawY);
            return true;
        });
    }

    public void pressMovementKey(KeyBinding key, long milliseconds) {
        runOnClientThread(() -> {
            key.setPressed(true);
            return true;
        });
        safeSleep(milliseconds);
        runOnClientThread(() -> {
            key.setPressed(false);
            return true;
        });
        safeSleep(40L);
    }

    public void pressMovementKeys(boolean forward, boolean back, boolean left, boolean right, boolean jump, boolean sneak, long milliseconds) {
        runOnClientThread(() -> {
            client.options.forwardKey.setPressed(forward);
            client.options.backKey.setPressed(back);
            client.options.leftKey.setPressed(left);
            client.options.rightKey.setPressed(right);
            client.options.jumpKey.setPressed(jump);
            client.options.sneakKey.setPressed(sneak);
            return true;
        });
        safeSleep(milliseconds);
        runOnClientThread(() -> {
            client.options.forwardKey.setPressed(false);
            client.options.backKey.setPressed(false);
            client.options.leftKey.setPressed(false);
            client.options.rightKey.setPressed(false);
            client.options.jumpKey.setPressed(false);
            client.options.sneakKey.setPressed(false);
            return true;
        });
    }

    // --- Private action methods ---

    private Map<String, Object> inputClick(Map<String, Object> params) {
        int x = getInt(params, "x");
        int y = getInt(params, "y");
        String button = normalizeMouseButton(getString(params, "button", "left"));
        List<String> modifiers = getStringList(params, "modifiers");
        return withTemporaryModifiers(modifiers, () -> {
            moveMouseTo(x, y);
            clickMouseButton(button);
            LinkedHashMap<String, Object> result = new LinkedHashMap<>();
            result.put("clicked", true);
            result.put("button", button);
            result.put("mouse", runOnClientThread(this::currentMousePosition));
            if (!modifiers.isEmpty()) {
                result.put("modifiers", modifiers);
            }
            return result;
        });
    }

    private Map<String, Object> inputDoubleClick(Map<String, Object> params) {
        int x = getInt(params, "x");
        int y = getInt(params, "y");
        String button = normalizeMouseButton(getString(params, "button", "left"));
        moveMouseTo(x, y);
        clickMouseButton(button);
        safeSleep(100L);
        clickMouseButton(button);
        return Map.of(
            "clicked", true,
            "button", button,
            "count", 2,
            "mouse", runOnClientThread(this::currentMousePosition)
        );
    }

    private Map<String, Object> inputMouseMove(Map<String, Object> params) {
        moveMouseTo(getInt(params, "x"), getInt(params, "y"));
        LinkedHashMap<String, Object> result = new LinkedHashMap<>(runOnClientThread(this::currentMousePosition));
        result.put("moved", true);
        return result;
    }

    private Map<String, Object> inputDrag(Map<String, Object> params) {
        int fromX = getInt(params, "fromX");
        int fromY = getInt(params, "fromY");
        int toX = getInt(params, "toX");
        int toY = getInt(params, "toY");
        String button = normalizeMouseButton(getString(params, "button", "left"));
        moveMouseTo(fromX, fromY);
        dispatchMouseButton(button, GLFW.GLFW_PRESS);
        safeSleep(50L);
        moveMouseTo(fromX, fromY);
        safeSleep(25L);
        int steps = Math.max(10, (int) Math.ceil(Math.hypot(toX - fromX, toY - fromY) / 8.0D));
        for (int step = 1; step <= steps; step++) {
            double progress = (double) step / (double) steps;
            int nextX = (int) Math.round(fromX + ((toX - fromX) * progress));
            int nextY = (int) Math.round(fromY + ((toY - fromY) * progress));
            moveMouseTo(nextX, nextY);
            safeSleep(25L);
        }
        dispatchMouseButton(button, GLFW.GLFW_RELEASE);
        return Map.of(
            "dragged", true,
            "button", button,
            "from", Map.of("x", fromX, "y", fromY),
            "to", Map.of("x", toX, "y", toY)
        );
    }

    private Map<String, Object> inputScroll(Map<String, Object> params) {
        int x = getInt(params, "x");
        int y = getInt(params, "y");
        int delta = getInt(params, "delta");
        moveMouseTo(x, y);
        runOnClientThread(() -> {
            ((MouseInvoker) client.mouse).mct$onMouseScroll(client.getWindow().getHandle(), 0.0D, delta);
            return true;
        });
        return Map.of(
            "scrolled", true,
            "delta", delta,
            "mouse", runOnClientThread(this::currentMousePosition)
        );
    }

    private Map<String, Object> inputKeyPress(Map<String, Object> params) {
        String keyName = getString(params, "key");
        pressInputBinding(resolveInputBinding(keyName), 100L);
        return Map.of("pressed", true, "key", normalizeInputName(keyName));
    }

    private Map<String, Object> inputKeyHold(Map<String, Object> params) {
        String keyName = getString(params, "key");
        long duration = Math.max(1L, getInt(params, "duration"));
        InputBinding binding = resolveInputBinding(keyName);
        Instant startedAt = Instant.now();
        dispatchInputBinding(binding, GLFW.GLFW_PRESS);
        safeSleep(duration);
        dispatchInputBinding(binding, GLFW.GLFW_RELEASE);
        return Map.of(
            "held", true,
            "key", binding.name(),
            "actualDuration", Duration.between(startedAt, Instant.now()).toMillis()
        );
    }

    private Map<String, Object> inputKeyDown(Map<String, Object> params) {
        InputBinding binding = resolveInputBinding(getString(params, "key"));
        dispatchInputBinding(binding, GLFW.GLFW_PRESS);
        return Map.of("down", true, "key", binding.name(), "keys", snapshotHeldInputKeys());
    }

    private Map<String, Object> inputKeyUp(Map<String, Object> params) {
        InputBinding binding = resolveInputBinding(getString(params, "key"));
        dispatchInputBinding(binding, GLFW.GLFW_RELEASE);
        return Map.of("up", true, "key", binding.name(), "keys", snapshotHeldInputKeys());
    }

    private Map<String, Object> inputKeyCombo(Map<String, Object> params) {
        List<InputBinding> keys = getList(params, "keys").stream()
            .map(String::valueOf)
            .map(this::resolveInputBinding)
            .toList();
        for (InputBinding binding : keys) {
            dispatchInputBinding(binding, GLFW.GLFW_PRESS);
            safeSleep(35L);
        }
        safeSleep(75L);
        for (int index = keys.size() - 1; index >= 0; index--) {
            dispatchInputBinding(keys.get(index), GLFW.GLFW_RELEASE);
            safeSleep(20L);
        }
        return Map.of(
            "pressed", true,
            "keys", keys.stream().map(InputBinding::name).toList()
        );
    }

    private Map<String, Object> inputType(Map<String, Object> params) {
        String text = getString(params, "text");
        runOnClientThread(() -> {
            if (client.currentScreen == null || client.getOverlay() != null) {
                throw new ActionException("INVALID_STATE");
            }
            long window = client.getWindow().getHandle();
            KeyboardInvoker keyboard = (KeyboardInvoker) client.keyboard;
            text.codePoints().forEach(codePoint -> keyboard.mct$onChar(window, codePoint, 0));
            return true;
        });
        return Map.of("typed", true, "text", text);
    }

    private Map<String, Object> inputKeysDown() {
        return Map.of("keys", snapshotHeldInputKeys());
    }

    // --- Internal helpers ---

    private LinkedHashMap<String, Object> currentMousePosition() {
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        result.put("x", rawToScaledX(client.mouse.getX()));
        result.put("y", rawToScaledY(client.mouse.getY()));
        return result;
    }

    private void clickMouseButton(String button) {
        dispatchMouseButton(button, GLFW.GLFW_PRESS);
        safeSleep(60L);
        dispatchMouseButton(button, GLFW.GLFW_RELEASE);
        safeSleep(40L);
    }

    private void dispatchMouseButton(String button, int action) {
        int glfwButton = switch (normalizeMouseButton(button)) {
            case "left" -> GLFW.GLFW_MOUSE_BUTTON_LEFT;
            case "right" -> GLFW.GLFW_MOUSE_BUTTON_RIGHT;
            case "middle" -> GLFW.GLFW_MOUSE_BUTTON_MIDDLE;
            default -> throw new ActionException("INVALID_PARAMS");
        };
        runOnClientThread(() -> {
            ((MouseInvoker) client.mouse).mct$onMouseButton(client.getWindow().getHandle(), glfwButton, action, 0);
            return true;
        });
    }

    private void pressInputBinding(InputBinding binding, long holdMillis) {
        dispatchInputBinding(binding, GLFW.GLFW_PRESS);
        safeSleep(holdMillis);
        dispatchInputBinding(binding, GLFW.GLFW_RELEASE);
        safeSleep(40L);
    }

    private void dispatchInputBinding(InputBinding binding, int action) {
        if (binding.keyBinding() != null) {
            runOnClientThread(() -> {
                KeyBinding keyBinding = binding.keyBinding();
                InputUtil.Key boundKey = ((KeyBindingAccessor) keyBinding).mct$getBoundKey();
                if (action != GLFW.GLFW_RELEASE) {
                    KeyBinding.onKeyPressed(boundKey);
                }
                KeyBinding.setKeyPressed(boundKey, action != GLFW.GLFW_RELEASE);
                return true;
            });
            updateHeldInputKey(binding.name(), action != GLFW.GLFW_RELEASE);
            return;
        }

        if (binding.mouseButton() != null) {
            dispatchMouseButton(binding.name(), action);
            updateHeldInputKey(binding.name(), action != GLFW.GLFW_RELEASE);
            return;
        }

        int keyCode = binding.keyCode();
        int scancode = GLFW.glfwGetKeyScancode(keyCode);
        runOnClientThread(() -> {
            client.keyboard.onKey(client.getWindow().getHandle(), keyCode, scancode, action, 0);
            return true;
        });
        updateHeldInputKey(binding.name(), action != GLFW.GLFW_RELEASE);
    }

    private void updateHeldInputKey(String key, boolean pressed) {
        if (pressed) {
            heldInputKeys.add(key);
        } else {
            heldInputKeys.remove(key);
        }
    }

    private List<String> snapshotHeldInputKeys() {
        synchronized (heldInputKeys) {
            return heldInputKeys.stream().sorted().toList();
        }
    }

    private <T> T withTemporaryModifiers(List<String> modifiers, java.util.function.Supplier<T> action) {
        ArrayList<InputBinding> acquired = new ArrayList<>();
        for (String modifier : modifiers) {
            InputBinding binding = resolveInputBinding(modifier);
            if (heldInputKeys.contains(binding.name())) {
                continue;
            }
            dispatchInputBinding(binding, GLFW.GLFW_PRESS);
            acquired.add(binding);
        }
        try {
            return action.get();
        } finally {
            for (int index = acquired.size() - 1; index >= 0; index--) {
                dispatchInputBinding(acquired.get(index), GLFW.GLFW_RELEASE);
            }
        }
    }

    private InputBinding resolveInputBinding(String keyName) {
        String normalized = normalizeInputName(keyName);
        if (normalized.length() == 1) {
            char value = normalized.charAt(0);
            if (value >= 'a' && value <= 'z') {
                return new InputBinding(normalized, GLFW.GLFW_KEY_A + (value - 'a'), null);
            }
            if (value >= '0' && value <= '9') {
                return new InputBinding(normalized, GLFW.GLFW_KEY_0 + (value - '0'), null);
            }
        }
        if (normalized.startsWith("f") && normalized.length() <= 3) {
            try {
                int functionIndex = Integer.parseInt(normalized.substring(1));
                if (functionIndex >= 1 && functionIndex <= 12) {
                    return new InputBinding(normalized, GLFW.GLFW_KEY_F1 + (functionIndex - 1), null);
                }
            } catch (NumberFormatException ignored) {
            }
        }
        return switch (normalized) {
            case "space" -> new InputBinding("space", GLFW.GLFW_KEY_SPACE, null);
            case "shift" -> new InputBinding("shift", GLFW.GLFW_KEY_LEFT_SHIFT, null);
            case "ctrl", "control" -> new InputBinding("ctrl", GLFW.GLFW_KEY_LEFT_CONTROL, null);
            case "alt" -> new InputBinding("alt", GLFW.GLFW_KEY_LEFT_ALT, null);
            case "tab" -> new InputBinding("tab", GLFW.GLFW_KEY_TAB, null);
            case "escape", "esc" -> new InputBinding("escape", GLFW.GLFW_KEY_ESCAPE, null);
            case "enter", "return" -> new InputBinding("enter", GLFW.GLFW_KEY_ENTER, null);
            case "backspace" -> new InputBinding("backspace", GLFW.GLFW_KEY_BACKSPACE, null);
            case "delete" -> new InputBinding("delete", GLFW.GLFW_KEY_DELETE, null);
            case "up" -> new InputBinding("up", GLFW.GLFW_KEY_UP, null);
            case "down" -> new InputBinding("down", GLFW.GLFW_KEY_DOWN, null);
            case "left" -> new InputBinding("left", GLFW.GLFW_KEY_LEFT, null);
            case "right" -> new InputBinding("right", GLFW.GLFW_KEY_RIGHT, null);
            case "minus" -> new InputBinding("minus", GLFW.GLFW_KEY_MINUS, null);
            case "equals" -> new InputBinding("equals", GLFW.GLFW_KEY_EQUAL, null);
            case "left-bracket" -> new InputBinding("left-bracket", GLFW.GLFW_KEY_LEFT_BRACKET, null);
            case "right-bracket" -> new InputBinding("right-bracket", GLFW.GLFW_KEY_RIGHT_BRACKET, null);
            case "slash" -> new InputBinding("slash", GLFW.GLFW_KEY_SLASH, null);
            case "inventory" -> new InputBinding("inventory", client.options.inventoryKey);
            case "drop" -> new InputBinding("drop", client.options.dropKey);
            case "sprint" -> new InputBinding("sprint", client.options.sprintKey);
            case "sneak" -> new InputBinding("sneak", client.options.sneakKey);
            case "attack" -> new InputBinding("left", null, Integer.valueOf(GLFW.GLFW_MOUSE_BUTTON_LEFT), null);
            case "use" -> new InputBinding("right", null, Integer.valueOf(GLFW.GLFW_MOUSE_BUTTON_RIGHT), null);
            case "middle", "pick" -> new InputBinding("middle", null, Integer.valueOf(GLFW.GLFW_MOUSE_BUTTON_MIDDLE), null);
            default -> throw new ActionException("INVALID_PARAMS");
        };
    }

    private String normalizeMouseButton(String button) {
        return switch (normalizeInputName(button)) {
            case "left", "attack" -> "left";
            case "right", "use" -> "right";
            case "middle", "pick" -> "middle";
            default -> throw new ActionException("INVALID_PARAMS");
        };
    }

    private String normalizeInputName(String value) {
        return value.toLowerCase(Locale.ROOT).trim();
    }

    private double scaledToRawX(double scaledX) {
        return scaledX * ((double) client.getWindow().getWidth() / (double) client.getWindow().getScaledWidth());
    }

    private double scaledToRawY(double scaledY) {
        return scaledY * ((double) client.getWindow().getHeight() / (double) client.getWindow().getScaledHeight());
    }

    private double rawToScaledX(double rawX) {
        return rawX * ((double) client.getWindow().getScaledWidth() / (double) client.getWindow().getWidth());
    }

    private double rawToScaledY(double rawY) {
        return rawY * ((double) client.getWindow().getScaledHeight() / (double) client.getWindow().getHeight());
    }

    private record InputBinding(String name, @Nullable Integer keyCode, @Nullable Integer mouseButton, @Nullable KeyBinding keyBinding) {

        private InputBinding(String name, int keyCode, @Nullable Integer mouseButton) {
            this(name, Integer.valueOf(keyCode), mouseButton, null);
        }

        private InputBinding(String name, KeyBinding keyBinding) {
            this(name, null, null, keyBinding);
        }
    }
}
