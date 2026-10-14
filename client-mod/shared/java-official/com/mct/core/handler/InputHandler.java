package com.mct.core.handler;

import static com.mct.core.util.ParamHelper.*;

import com.mct.core.concurrent.TemporaryInputLeases;
import com.mct.core.concurrent.TemporaryInputLeases.Scope;
import com.mct.core.input.KeyboardInputBridge;
import com.mct.core.input.MouseInputBridge;
import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.mixin.KeyBindingAccessor;
import com.mct.version.ClientVersionModulesHolder;
import com.mojang.blaze3d.platform.InputConstants;
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
import java.util.stream.Collectors;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import org.jetbrains.annotations.Nullable;
import org.lwjgl.glfw.GLFW;

public final class InputHandler extends ActionHandler {

    private final Set<String> heldInputKeys = Collections.synchronizedSet(new LinkedHashSet<>());
    private final MouseInputHandler mouseInput;
    private static final TemporaryInputLeases TEMPORARY_INPUT = TemporaryInputLeases.getInstance();
    private final Set<Object> heldControls = new LinkedHashSet<>();
    private final Map<String, Set<Object>> namedControls = new LinkedHashMap<>();

    public InputHandler(Minecraft client, ClientStateTracker stateTracker) {
        super(client, stateTracker);
        this.mouseInput = new MouseInputHandler(client, stateTracker, this);
    }

    @Override
    public Map<String, Object> handle(String action, Map<String, Object> params) {
        return switch (action) {
            case "input.click", "input.double-click", "input.mouse-move", "input.drag", "input.scroll", "input.mouse-pos" -> mouseInput.handle(action, params);
            case "input.key-press" -> inputKeyPress(params);
            case "input.key-hold" -> inputKeyHold(params);
            case "input.key-down" -> inputKeyDown(params);
            case "input.key-up" -> inputKeyUp(params);
            case "input.key-combo" -> inputKeyCombo(params);
            case "input.type" -> inputType(params);
            case "input.keys-down" -> inputKeysDown();
            default -> throw new ActionException("INVALID_ACTION");
        };
    }

    // --- Public helpers used by other handlers ---

    public void moveMouseTo(int scaledX, int scaledY) {
        mouseInput.moveMouseTo(scaledX, scaledY);
    }

    public void pressMovementKey(KeyMapping key, long milliseconds) {
        Scope scope = temporaryInputScope();
        try { acquireMovementKey(scope, key); safeSleep(milliseconds); }
        finally { closeTemporaryInput(scope); }
        safeSleep(40L);
    }

    public void pressMovementKeys(boolean forward, boolean back, boolean left, boolean right, boolean jump, boolean sneak, long milliseconds) {
        Scope scope = temporaryInputScope();
        try {
            if (forward) acquireMovementKey(scope, client.options.keyUp);
            if (back) acquireMovementKey(scope, client.options.keyDown);
            if (left) acquireMovementKey(scope, client.options.keyLeft);
            if (right) acquireMovementKey(scope, client.options.keyRight);
            if (jump) acquireMovementKey(scope, client.options.keyJump);
            if (sneak) acquireMovementKey(scope, client.options.keyShift);
            safeSleep(milliseconds);
        } finally { closeTemporaryInput(scope); }
    }

    // --- Private action methods ---

    private Map<String, Object> inputKeyPress(Map<String, Object> params) {
        String keyName = getString(params, "key");
        pressInputBinding(resolveInputBinding(keyName), 100L);
        return com.mct.core.util.MctMaps.mapOf("pressed", true, "key", normalizeInputName(keyName));
    }

    private Map<String, Object> inputKeyHold(Map<String, Object> params) {
        String keyName = getString(params, "key");
        long duration = Math.max(1L, getInt(params, "duration"));
        InputBinding binding = resolveInputBinding(keyName);
        Instant startedAt = Instant.now();
        Scope scope = temporaryInputScope();
        try { acquireInputBinding(scope, binding); safeSleep(duration); }
        finally { closeTemporaryInput(scope); }
        return com.mct.core.util.MctMaps.mapOf(
            "held", true,
            "key", binding.name,
            "actualDuration", Duration.between(startedAt, Instant.now()).toMillis()
        );
    }

    private Map<String, Object> inputKeyDown(Map<String, Object> params) {
        InputBinding binding = resolveInputBinding(getString(params, "key"));
        dispatchInputBinding(binding, GLFW.GLFW_PRESS);
        return com.mct.core.util.MctMaps.mapOf("down", true, "key", binding.name, "keys", snapshotHeldInputKeys());
    }

    private Map<String, Object> inputKeyUp(Map<String, Object> params) {
        InputBinding binding = resolveInputBinding(getString(params, "key"));
        dispatchInputBinding(binding, GLFW.GLFW_RELEASE);
        return com.mct.core.util.MctMaps.mapOf("up", true, "key", binding.name, "keys", snapshotHeldInputKeys());
    }

    private Map<String, Object> inputKeyCombo(Map<String, Object> params) {
        List<InputBinding> keys = getList(params, "keys").stream()
            .map(String::valueOf)
            .map(this::resolveInputBinding)
            .collect(Collectors.toList());
        Scope scope = temporaryInputScope();
        try {
            for (InputBinding binding : keys) {
                acquireInputBinding(scope, binding);
                safeSleep(35L);
            }
            safeSleep(75L);
        } finally { closeTemporaryInput(scope); }
        return com.mct.core.util.MctMaps.mapOf(
            "pressed", true,
            "keys", keys.stream().map(b -> b.name).collect(Collectors.toList())
        );
    }

    private Map<String, Object> inputType(Map<String, Object> params) {
        String text = getString(params, "text");
        runOnClientThread(() -> {
            if (ClientVersionModulesHolder.get().compatibility().getScreen(client) == null
                || ClientVersionModulesHolder.get().compatibility().getOverlay(client) != null) {
                throw new ActionException("INVALID_STATE");
            }
            long window = client.getWindow().handle();
            KeyboardInputBridge keyboard = (KeyboardInputBridge) client.keyboardHandler;
            text.codePoints().forEach(codePoint -> keyboard.mct$onChar(window, codePoint, 0));
            return true;
        });
        return com.mct.core.util.MctMaps.mapOf("typed", true, "text", text);
    }

    private Map<String, Object> inputKeysDown() {
        return com.mct.core.util.MctMaps.mapOf("keys", snapshotHeldInputKeys());
    }

    // --- Internal helpers ---

    private void dispatchMouseButton(String button, int action) {
        mouseInput.dispatchMouseButton(button, action);
    }

    private void pressInputBinding(InputBinding binding, long holdMillis) {
        Scope scope = temporaryInputScope();
        try { acquireInputBinding(scope, binding); safeSleep(holdMillis); }
        finally { closeTemporaryInput(scope); }
        safeSleep(40L);
    }

    private void rawDispatchInputBinding(InputBinding binding, int action) {
        if (binding.keyBinding != null) {
            runOnClientThread(() -> {
                KeyMapping keyBinding = binding.keyBinding;
                InputConstants.Key boundKey = ((KeyBindingAccessor) keyBinding).mct$getBoundKey();
                if (action != GLFW.GLFW_RELEASE) {
                    KeyMapping.click(boundKey);
                }
                KeyMapping.set(boundKey, action != GLFW.GLFW_RELEASE);
                return true;
            });
            updateHeldInputKey(binding, action != GLFW.GLFW_RELEASE);
            return;
        }

        if (binding.mouseButton != null) {
            dispatchMouseButton(binding.name, action);
            updateHeldInputKey(binding, action != GLFW.GLFW_RELEASE);
            return;
        }

        int keyCode = binding.keyCode;
        int scancode = GLFW.glfwGetKeyScancode(keyCode);
        runOnClientThread(() -> {
            ClientVersionModulesHolder.get().compatibility().dispatchKey(client, keyCode, scancode, action);
            return true;
        });
        updateHeldInputKey(binding, action != GLFW.GLFW_RELEASE);
    }

    private void updateHeldInputKey(InputBinding binding, boolean pressed) {
        String key = binding.name;
        Object control = physicalInputKey(binding);
        recordControl(control, pressed);
        if (pressed) {
            heldInputKeys.add(key);
            namedControls.computeIfAbsent(key, ignored -> new LinkedHashSet<>()).add(control);
        }
    }

    private void recordControl(Object control, boolean held) {
        if (held) { heldControls.add(control); return; }
        heldControls.remove(control);
        java.util.Iterator<Map.Entry<String, Set<Object>>> names = namedControls.entrySet().iterator();
        while (names.hasNext()) {
            Map.Entry<String, Set<Object>> name = names.next();
            name.getValue().remove(control);
            if (name.getValue().isEmpty()) { heldInputKeys.remove(name.getKey()); names.remove(); }
        }
    }

    private List<String> snapshotHeldInputKeys() {
        synchronized (heldInputKeys) {
            return heldInputKeys.stream().sorted().collect(Collectors.toList());
        }
    }

    <T> T withTemporaryModifiers(List<String> modifiers, java.util.function.Supplier<T> action) {
        Scope scope = temporaryInputScope();
        try {
            for (String modifier : modifiers) acquireInputBinding(scope, resolveInputBinding(modifier));
            return action.get();
        } finally { closeTemporaryInput(scope); }
    }


    Scope temporaryInputScope() {
        try { return TEMPORARY_INPUT.openScope(); }
        catch (java.util.concurrent.RejectedExecutionException full) { throw new ActionException("CLIENT_BUSY"); }
    }

    void closeTemporaryInput(Scope scope) {
        scope.close();
        // On cancellation the tick-owned cleanup remains live without occupying a worker.
        if (!Thread.currentThread().isInterrupted()) runOnClientThread(() -> { TEMPORARY_INPUT.drainClosed(); return true; });
    }

    private Object physicalInputKey(InputBinding binding) {
        if (binding.mouseButton != null) return "mouse:" + binding.mouseButton;
        return binding.keyBinding == null ? "key:" + binding.keyCode : physicalMovementKey(binding.keyBinding);
    }

    private Object physicalMovementKey(KeyMapping binding) {
        InputConstants.Key bound = ((KeyBindingAccessor) binding).mct$getBoundKey();
        String kind = bound.getType() == InputConstants.Type.MOUSE ? "mouse:" : bound.getType() == InputConstants.Type.SCANCODE ? "scan:" : "key:";
        return kind + bound.getValue();
    }

    private boolean inputIsHeld(InputBinding binding) {
        Object physical = physicalInputKey(binding);
        if (heldControls.contains(physical)) return true;
        for (KeyMapping mapping : client.options.keyMappings) {
            if (physicalMovementKey(mapping).equals(physical) && mapping.isDown()) return true;
        }
        String identity = physical.toString();
        int code = Integer.parseInt(identity.substring(identity.indexOf(':') + 1));
        if (identity.startsWith("mouse:")) return GLFW.glfwGetMouseButton(client.getWindow().handle(), code) == GLFW.GLFW_PRESS;
        return identity.startsWith("key:") && code >= 0 && GLFW.glfwGetKey(client.getWindow().handle(), code) == GLFW.GLFW_PRESS;
    }

    private void acquireInputBinding(Scope scope, InputBinding binding) {
        runOnClientThread(() -> {
            try {
                if (!TEMPORARY_INPUT.acquire(scope, physicalInputKey(binding), () -> inputIsHeld(binding),
                        held -> rawDispatchInputBinding(binding, held ? GLFW.GLFW_PRESS : GLFW.GLFW_RELEASE)))
                    throw new ActionException("INTERNAL_ERROR");
                updateHeldInputKey(binding, true);
            } catch (java.util.concurrent.RejectedExecutionException full) { throw new ActionException("CLIENT_BUSY"); }
            return true;
        });
    }

    void acquireMouseButton(Scope scope, String name) {
        String button = normalizeMouseButton(name);
        int code = "left".equals(button) ? GLFW.GLFW_MOUSE_BUTTON_LEFT : "right".equals(button) ? GLFW.GLFW_MOUSE_BUTTON_RIGHT : GLFW.GLFW_MOUSE_BUTTON_MIDDLE;
        acquireInputBinding(scope, new InputBinding(button, null, code, null));
    }

    private void acquireMovementKey(Scope scope, KeyMapping key) {
        runOnClientThread(() -> {
            Object control = physicalMovementKey(key);
            try {
                if (!TEMPORARY_INPUT.acquire(scope, control, key::isDown, held -> writeMovementKey(key, held)))
                    throw new ActionException("INTERNAL_ERROR");
            } catch (java.util.concurrent.RejectedExecutionException full) { throw new ActionException("CLIENT_BUSY"); }
            return true;
        });
    }

    private void writeMovementKey(KeyMapping key, boolean held) {
        InputConstants.Key bound = ((KeyBindingAccessor) key).mct$getBoundKey();
        if (bound.getType() == InputConstants.Type.MOUSE) {
            int button = bound.getValue();
            if (button < 0 || button > 2) {
                // Extra buttons still need the native release path, not only a key flag.
                runOnClientThread(() -> {
                    ((MouseInputBridge) client.mouseHandler).mct$onMouseButton(client.getWindow().handle(), button,
                        held ? GLFW.GLFW_PRESS : GLFW.GLFW_RELEASE, 0);
                    return true;
                });
            } else mouseInput.dispatchMouseButton(button == 0 ? "left" : button == 1 ? "right" : "middle",
                held ? GLFW.GLFW_PRESS : GLFW.GLFW_RELEASE);
        } else {
            if (held) KeyMapping.click(bound);
            KeyMapping.set(bound, held);
        }
        recordControl(physicalMovementKey(key), held);
    }

    public void setMovementKey(KeyMapping key, boolean held) {
        Object control = physicalMovementKey(key);
        TEMPORARY_INPUT.persistent(control, held, value -> writeMovementKey(key, value));
    }

    private void dispatchInputBinding(InputBinding binding, int action) {
        runOnClientThread(() -> {
            TEMPORARY_INPUT.persistent(physicalInputKey(binding), action != GLFW.GLFW_RELEASE,
                held -> rawDispatchInputBinding(binding, held ? GLFW.GLFW_PRESS : GLFW.GLFW_RELEASE));
            if (action != GLFW.GLFW_RELEASE) updateHeldInputKey(binding, true);
            return true;
        });
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
            case "inventory" -> new InputBinding("inventory", client.options.keyInventory);
            case "drop" -> new InputBinding("drop", client.options.keyDrop);
            case "sprint" -> new InputBinding("sprint", client.options.keySprint);
            case "sneak" -> new InputBinding("sneak", client.options.keyShift);
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
        return scaledX * ((double) client.getWindow().getScreenWidth() / (double) client.getWindow().getGuiScaledWidth());
    }

    private double scaledToRawY(double scaledY) {
        return scaledY * ((double) client.getWindow().getScreenHeight() / (double) client.getWindow().getGuiScaledHeight());
    }

    private double rawToScaledX(double rawX) {
        return rawX * ((double) client.getWindow().getGuiScaledWidth() / (double) client.getWindow().getScreenWidth());
    }

    private double rawToScaledY(double rawY) {
        return rawY * ((double) client.getWindow().getGuiScaledHeight() / (double) client.getWindow().getScreenHeight());
    }

    private static final class InputBinding {
        final String name;
        final Integer keyCode;
        final Integer mouseButton;
        final KeyMapping keyBinding;

        InputBinding(String name, @Nullable Integer keyCode, @Nullable Integer mouseButton, @Nullable KeyMapping keyBinding) {
            this.name = name;
            this.keyCode = keyCode;
            this.mouseButton = mouseButton;
            this.keyBinding = keyBinding;
        }

        InputBinding(String name, int keyCode, @Nullable Integer mouseButton) {
            this(name, Integer.valueOf(keyCode), mouseButton, null);
        }

        InputBinding(String name, KeyMapping keyBinding) {
            this(name, null, null, keyBinding);
        }
    }
}
