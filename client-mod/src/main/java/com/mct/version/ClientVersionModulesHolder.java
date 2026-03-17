package com.mct.version;

public final class ClientVersionModulesHolder {

    private static final ClientVersionModules INSTANCE = VersionAdapters.create();

    private ClientVersionModulesHolder() {}

    public static ClientVersionModules get() {
        return INSTANCE;
    }
}
