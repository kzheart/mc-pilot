package com.mct.mixin;

import com.mct.core.state.ClientTickSampler;
import net.minecraft.client.MinecraftClient;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(MinecraftClient.class)
public abstract class MinecraftClientTickMixin {

    @Inject(method = "tick", at = @At("TAIL"))
    private void mct$sampleTick(CallbackInfo ci) {
        ClientTickSampler.getInstance().sample((MinecraftClient) (Object) this);
    }
}
