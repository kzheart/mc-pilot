package com.mct.core.protocol;

import java.util.Map;

public record Response(String id, boolean success, Map<String, Object> data, String error) {
}
