package com.mct.version;

public final class ClientVersionModulesHolder {

    private static volatile ClientVersionModules instance;

    private ClientVersionModulesHolder() {}

    public static void init(ClientVersionModules modules) {
        instance = modules;
    }

    public static ClientVersionModules get() {
        ClientVersionModules modules = instance;
        if (modules == null) {
            throw new IllegalStateException("ClientVersionModules not initialized");
        }
        return modules;
    }
}
