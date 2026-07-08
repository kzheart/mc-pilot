package com.mct.version;

import com.mct.core.input.KeyboardInputBridge;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.Direction;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.level.GameType;
import net.minecraft.world.phys.Vec3;

public interface VersionCompatibility extends ClientWorldAccessor {
    @Override
    default ClientLevel getClientWorld(LocalPlayer player) {
        Object world = readField(player, "clientWorld");
        if (world == null) {
            world = invoke(player, "getEntityWorld");
        }
        return (ClientLevel) world;
    }

    default Vec3 getPlayerPos(LocalPlayer player) {
        Object position = invoke(player, "getPos");
        if (position == null) {
            position = invoke(player, "getEntityPos");
        }
        return (Vec3) position;
    }

    default int getSelectedSlot(Inventory inventory) {
        Object selected = readField(inventory, "selectedSlot");
        if (selected == null) {
            selected = invoke(inventory, "getSelectedSlot");
        }
        return ((Number) selected).intValue();
    }

    default void setSelectedSlot(Inventory inventory, int slot) {
        if (writeField(inventory, "selectedSlot", slot)) {
            return;
        }
        invoke(inventory, "setSelectedSlot", new Class<?>[] { int.class }, new Object[] { slot });
    }

    default Direction directionByName(String name) {
        Object direction = invokeStatic(Direction.class, "byName", new Class<?>[] { String.class }, new Object[] { name });
        if (direction == null) {
            direction = invokeStatic(Direction.class, "byId", new Class<?>[] { String.class }, new Object[] { name });
        }
        return (Direction) direction;
    }

    default String gameModeName(GameType gameMode) {
        Object name = invoke(gameMode, "getName");
        if (name == null) {
            name = invoke(gameMode, "getId");
        }
        return String.valueOf(name);
    }

    default String profileName(PlayerInfo entry) {
        Object profile = entry.getProfile();
        Object name = invoke(profile, "getName");
        if (name == null) {
            name = invoke(profile, "name");
        }
        return String.valueOf(name);
    }

    default String worldDifficultyName(ClientLevel world) {
        Object difficulty = invoke(world, "getDifficulty");
        if (difficulty == null) {
            Object levelProperties = invoke(world, "getLevelProperties");
            difficulty = invoke(levelProperties, "getDifficulty");
        }
        return String.valueOf(invoke(difficulty, "getName"));
    }

    default long worldTime(ClientLevel world) {
        Object time = invoke(world, "getTime");
        if (time == null) {
            time = invoke(world, "getTimeOfDay");
        }
        return ((Number) time).longValue();
    }

    default void dispatchKey(Minecraft client, int keyCode, int scancode, int action) {
        ((KeyboardInputBridge) client.keyboardHandler).mct$onKey(client.getWindow().handle(), keyCode, scancode, action, 0);
    }

    static Object readField(Object target, String name) {
        try {
            Field field = target.getClass().getField(name);
            return field.get(target);
        } catch (ReflectiveOperationException ignored) {
            return null;
        }
    }

    static boolean writeField(Object target, String name, Object value) {
        try {
            Field field = target.getClass().getField(name);
            field.set(target, value);
            return true;
        } catch (ReflectiveOperationException ignored) {
            return false;
        }
    }

    static Object invoke(Object target, String name) {
        if (target == null) {
            return null;
        }
        return invoke(target, name, new Class<?>[0], new Object[0]);
    }

    static Object invoke(Object target, String name, Class<?>[] parameterTypes, Object[] args) {
        try {
            Method method = target.getClass().getMethod(name, parameterTypes);
            return method.invoke(target, args);
        } catch (ReflectiveOperationException ignored) {
            return null;
        }
    }

    static Object invokeStatic(Class<?> type, String name, Class<?>[] parameterTypes, Object[] args) {
        try {
            Method method = type.getMethod(name, parameterTypes);
            return method.invoke(null, args);
        } catch (ReflectiveOperationException ignored) {
            return null;
        }
    }
}
