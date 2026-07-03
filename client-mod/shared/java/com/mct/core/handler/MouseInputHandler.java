package com.mct.core.handler;

import static com.mct.core.util.ParamHelper.getInt;
import static com.mct.core.util.ParamHelper.getString;
import static com.mct.core.util.ParamHelper.getStringList;

import com.mct.core.input.MouseInputBridge;
import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import net.minecraft.client.MinecraftClient;
import org.lwjgl.glfw.GLFW;

public final class MouseInputHandler extends ActionHandler {

    private final InputHandler keyboardInput;

    public MouseInputHandler(MinecraftClient client, ClientStateTracker stateTracker, InputHandler keyboardInput) {
        super(client, stateTracker);
        this.keyboardInput = keyboardInput;
    }

    @Override
    public Map<String, Object> handle(String action, Map<String, Object> params) {
        return switch (action) {
            case "input.click" -> inputClick(params);
            case "input.double-click" -> inputDoubleClick(params);
            case "input.mouse-move" -> inputMouseMove(params);
            case "input.drag" -> inputDrag(params);
            case "input.scroll" -> inputScroll(params);
            case "input.mouse-pos" -> runOnClientThread(this::currentMousePosition);
            default -> throw new ActionException("INVALID_ACTION");
        };
    }

    public void moveMouseTo(int scaledX, int scaledY) {
        runOnClientThread(() -> {
            long window = client.getWindow().getHandle();
            double rawX = scaledToRawX(scaledX);
            double rawY = scaledToRawY(scaledY);
            GLFW.glfwSetCursorPos(window, rawX, rawY);
            ((MouseInputBridge) client.mouse).mct$onCursorPos(window, rawX, rawY);
            return true;
        });
    }

    void dispatchMouseButton(String button, int action) {
        int glfwButton = switch (normalizeMouseButton(button)) {
            case "left" -> GLFW.GLFW_MOUSE_BUTTON_LEFT;
            case "right" -> GLFW.GLFW_MOUSE_BUTTON_RIGHT;
            case "middle" -> GLFW.GLFW_MOUSE_BUTTON_MIDDLE;
            default -> throw new ActionException("INVALID_PARAMS");
        };
        runOnClientThread(() -> {
            ((MouseInputBridge) client.mouse).mct$onMouseButton(client.getWindow().getHandle(), glfwButton, action, 0);
            return true;
        });
    }

    private Map<String, Object> inputClick(Map<String, Object> params) {
        int x = getInt(params, "x");
        int y = getInt(params, "y");
        String button = normalizeMouseButton(getString(params, "button", "left"));
        List<String> modifiers = getStringList(params, "modifiers");
        return keyboardInput.withTemporaryModifiers(modifiers, () -> {
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
        return com.mct.core.util.MctMaps.mapOf(
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
        return com.mct.core.util.MctMaps.mapOf(
            "dragged", true,
            "button", button,
            "from", com.mct.core.util.MctMaps.mapOf("x", fromX, "y", fromY),
            "to", com.mct.core.util.MctMaps.mapOf("x", toX, "y", toY)
        );
    }

    private Map<String, Object> inputScroll(Map<String, Object> params) {
        int x = getInt(params, "x");
        int y = getInt(params, "y");
        int delta = getInt(params, "delta");
        moveMouseTo(x, y);
        runOnClientThread(() -> {
            ((MouseInputBridge) client.mouse).mct$onMouseScroll(client.getWindow().getHandle(), 0.0D, delta);
            return true;
        });
        return com.mct.core.util.MctMaps.mapOf(
            "scrolled", true,
            "delta", delta,
            "mouse", runOnClientThread(this::currentMousePosition)
        );
    }

    private void clickMouseButton(String button) {
        dispatchMouseButton(button, GLFW.GLFW_PRESS);
        safeSleep(60L);
        dispatchMouseButton(button, GLFW.GLFW_RELEASE);
        safeSleep(40L);
    }

    private LinkedHashMap<String, Object> currentMousePosition() {
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        result.put("x", rawToScaledX(client.mouse.getX()));
        result.put("y", rawToScaledY(client.mouse.getY()));
        return result;
    }

    private String normalizeMouseButton(String button) {
        return switch (button.toLowerCase(Locale.ROOT).trim()) {
            case "left", "attack" -> "left";
            case "right", "use" -> "right";
            case "middle", "pick" -> "middle";
            default -> throw new ActionException("INVALID_PARAMS");
        };
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
}
