package com.mct.mixin;

import com.mct.core.resourcepack.ResourcePackSupport;
import com.mct.core.state.ClientStateTracker;
import net.minecraft.network.ClientConnection;
import net.minecraft.network.packet.Packet;
import net.minecraft.network.packet.c2s.common.ResourcePackStatusC2SPacket;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Observe vanilla outcomes on the active connection, ignoring stale downloads from old joins. */
@Mixin(ClientConnection.class)
public abstract class ResourcePackStatusMixin {
    @Inject(method = "send(Lnet/minecraft/network/packet/Packet;)V", at = @At("HEAD"))
    private void mct$observeStatus(Packet<?> packet, CallbackInfo ci) {
        if (ResourcePackSupport.isActiveConnection((ClientConnection) (Object) this)
                && packet instanceof ResourcePackStatusC2SPacket status) {
            ClientStateTracker.getInstance().resourcePacks().status(status.id().toString(), status.status().name());
        }
    }
}
