package com.mct.mixin;

import com.mct.core.resourcepack.ResourcePackSupport;
import com.mct.core.state.ClientStateTracker;
import net.minecraft.network.Connection;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.common.ServerboundResourcePackPacket;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Observe vanilla outcomes on the active connection, ignoring stale downloads from old joins. */
@Mixin(Connection.class)
public abstract class ResourcePackStatusMixin {
    @Inject(method = "send(Lnet/minecraft/network/protocol/Packet;)V", at = @At("HEAD"))
    private void mct$observeStatus(Packet<?> packet, CallbackInfo ci) {
        if (ResourcePackSupport.isActiveConnection((Connection) (Object) this)
                && packet instanceof ServerboundResourcePackPacket status) {
            ClientStateTracker.getInstance().resourcePacks().status(status.id().toString(), status.action().name());
        }
    }
}
