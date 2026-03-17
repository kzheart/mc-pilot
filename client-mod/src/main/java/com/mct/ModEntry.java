package com.mct;

import com.mct.variant.TargetVariant;
import net.fabricmc.api.ModInitializer;

public final class ModEntry implements ModInitializer {

    @Override
    public void onInitialize() {
        TargetVariant.id();
    }
}
