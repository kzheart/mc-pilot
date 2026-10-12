package com.mct.mixin;

import com.mct.core.state.ClientTickSampler;
import com.mct.core.concurrent.ClientTaskQueue;
import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Minecraft.class)
public abstract class MinecraftClientTickMixin {

    @Inject(method = "tick", at = @At("TAIL"))
    private void mct$sampleTick(CallbackInfo ci) {
        ClientTaskQueue.getInstance().drain();
        ClientTickSampler.getInstance().sample((Minecraft) (Object) this);
    }
}
