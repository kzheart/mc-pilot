package com.mct.core.util;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public final class MctMaps {
    private MctMaps() {
    }

    public static Map<String, Object> mapOf(Object... entries) {
        if (entries.length == 0) {
            return Collections.emptyMap();
        }
        if (entries.length % 2 != 0) {
            throw new IllegalArgumentException("mapOf requires key/value pairs");
        }
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        for (int i = 0; i < entries.length; i += 2) {
            result.put(String.valueOf(entries[i]), entries[i + 1]);
        }
        return result;
    }
}
