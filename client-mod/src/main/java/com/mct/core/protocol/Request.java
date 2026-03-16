package com.mct.core.protocol;

import java.util.Map;

public record Request(String id, String action, Map<String, Object> params) {
}
