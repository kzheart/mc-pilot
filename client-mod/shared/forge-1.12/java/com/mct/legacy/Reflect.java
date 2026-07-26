package com.mct.legacy;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Reflection helpers accepting both MCP (dev) and SRG (production) member names,
 * mirroring what Forge's ObfuscationReflectionHelper does.
 */
public final class Reflect {

    private static final Map<String, Field> FIELD_CACHE = new ConcurrentHashMap<String, Field>();
    private static final Map<String, Method> METHOD_CACHE = new ConcurrentHashMap<String, Method>();

    private Reflect() {
    }

    public static Field field(Class<?> owner, String... names) {
        String cacheKey = owner.getName() + "#" + names[0];
        Field cached = FIELD_CACHE.get(cacheKey);
        if (cached != null) {
            return cached;
        }
        for (Class<?> type = owner; type != null; type = type.getSuperclass()) {
            for (String name : names) {
                try {
                    Field found = type.getDeclaredField(name);
                    found.setAccessible(true);
                    FIELD_CACHE.put(cacheKey, found);
                    return found;
                } catch (NoSuchFieldException ignored) {
                }
            }
        }
        throw new LegacyActionException("INTERNAL_ERROR", "field not found: " + cacheKey);
    }

    @SuppressWarnings("unchecked")
    public static <T> T get(Object target, Class<?> owner, String... names) {
        try {
            return (T) field(owner, names).get(target);
        } catch (IllegalAccessException exception) {
            throw new LegacyActionException("INTERNAL_ERROR", "field access: " + names[0]);
        }
    }

    public static void set(Object target, Object value, Class<?> owner, String... names) {
        try {
            field(owner, names).set(target, value);
        } catch (IllegalAccessException exception) {
            throw new LegacyActionException("INTERNAL_ERROR", "field write: " + names[0]);
        }
    }

    public static Method method(Class<?> owner, Class<?>[] parameterTypes, String... names) {
        String cacheKey = owner.getName() + "#" + names[0] + "/" + parameterTypes.length;
        Method cached = METHOD_CACHE.get(cacheKey);
        if (cached != null) {
            return cached;
        }
        for (Class<?> type = owner; type != null; type = type.getSuperclass()) {
            for (String name : names) {
                try {
                    Method found = type.getDeclaredMethod(name, parameterTypes);
                    found.setAccessible(true);
                    METHOD_CACHE.put(cacheKey, found);
                    return found;
                } catch (NoSuchMethodException ignored) {
                }
            }
        }
        throw new LegacyActionException("INTERNAL_ERROR", "method not found: " + cacheKey);
    }

    @SuppressWarnings("unchecked")
    public static <T> T invoke(Object target, Class<?> owner, Class<?>[] parameterTypes, Object[] arguments, String... names) {
        try {
            return (T) method(owner, parameterTypes, names).invoke(target, arguments);
        } catch (Exception exception) {
            if (exception.getCause() instanceof LegacyActionException) {
                throw (LegacyActionException) exception.getCause();
            }
            throw new LegacyActionException("INTERNAL_ERROR", "invoke " + names[0] + ": " + exception);
        }
    }
}
