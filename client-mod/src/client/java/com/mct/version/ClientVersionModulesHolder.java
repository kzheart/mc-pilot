package com.mct.version;

import com.mct.variant.TargetVariant;

public final class ClientVersionModulesHolder {

    private static final ClientVersionModules INSTANCE = create();

    private ClientVersionModulesHolder() {
    }

    public static ClientVersionModules get() {
        return INSTANCE;
    }

    private static ClientVersionModules create() {
        String providerClassName = switch (TargetVariant.id()) {
            case "1.20.1-fabric" -> "com.mct.version.v1201.Fabric1201ClientVersionModulesProvider";
            case "1.20.4-fabric" -> "com.mct.version.v1204.Fabric1204ClientVersionModulesProvider";
            default -> throw new IllegalStateException("Unsupported client variant: " + TargetVariant.id());
        };

        try {
            ClientVersionModulesProvider provider = (ClientVersionModulesProvider) Class.forName(providerClassName)
                .getDeclaredConstructor()
                .newInstance();
            return provider.create();
        } catch (ReflectiveOperationException exception) {
            throw new IllegalStateException("Failed to initialize version modules for " + TargetVariant.id(), exception);
        }
    }
}
