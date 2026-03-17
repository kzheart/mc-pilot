package com.mct.version;

public final class ClientVersionAdapters {

    private static final ClientVersionAdapter INSTANCE = ClientVersionAdapterFactory.create();

    private ClientVersionAdapters() {
    }

    public static ClientVersionAdapter get() {
        return INSTANCE;
    }
}
