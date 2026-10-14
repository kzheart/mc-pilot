package com.mct.core.resourcepack;

import java.util.Locale;
import java.util.function.Function;

/** The explicit policy takes precedence; a saved refusal is respected by default. */
public final class ResourcePackPolicy {
    private ResourcePackPolicy() {}

    public static String parse(String value) {
        if (value == null || value.trim().isEmpty()) return null;
        String policy = value.trim().toLowerCase(Locale.ROOT);
        if (!policy.equals("accept") && !policy.equals("prompt") && !policy.equals("reject")) {
            throw new IllegalArgumentException("resourcePackPolicy must be accept, prompt, or reject");
        }
        return policy;
    }

    /** Older --server launches supply no saved entry. Preserve real entries; synthesize only missing ones. */
    public static <T> T ensureServerInfo(T supplied, String host, int port, Function<String, T> factory) {
        if (supplied != null) return supplied;
        String address = host.indexOf(':') >= 0 && !host.startsWith("[") ? "[" + host + "]" : host;
        return factory.apply(address + ":" + port);
    }

    public static String resolve(String override, String environment, boolean savedDisabled) {
        String explicit = parse(override);
        if (explicit == null) explicit = parse(environment);
        return explicit != null ? explicit : savedDisabled ? "reject" : "accept";
    }
}
