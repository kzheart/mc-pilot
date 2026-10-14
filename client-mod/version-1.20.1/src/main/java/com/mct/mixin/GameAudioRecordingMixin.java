package com.mct.mixin;

import com.mct.audio.GameAudioCapture;
import com.mct.audio.GameAudioExecutorBridge;
import java.util.concurrent.Executor;
import com.mct.core.recording.AudioCapture;
import java.nio.IntBuffer;
import net.minecraft.client.sound.SoundEngine;
import org.lwjgl.openal.ALC10;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** 1.20.1 adapter (live-tested on Fabric): diverts the actual game mixer before it creates any sound sources. */
@Mixin(SoundEngine.class)
public abstract class GameAudioRecordingMixin implements GameAudioExecutorBridge {
    @Shadow private long devicePointer;
    @Shadow private long contextPointer;
    @Shadow public abstract void close();
    @Shadow private static long openDeviceOrFallback(String name) { throw new AssertionError(); }
    @Unique private GameAudioCapture mct$audio;
    @Unique private Executor mct$soundExecutor;

    @Override public void mct$setSoundExecutor(Executor executor) { mct$soundExecutor = executor; }
    @Unique private boolean mct$directionalAudio;

    @Inject(method = "init", at = @At("HEAD"))
    private void mct$prepareAudio(String device, boolean directionalAudio, CallbackInfo ci) {
        mct$directionalAudio = directionalAudio;
        if (mct$audio != null) {
            // A previous close may have been deferred while a native render was in flight.
            // Retry the whole engine close, including Minecraft-owned native resources.
            close();
            if (mct$audio != null) throw new IllegalStateException("Previous game audio device is still in use");
        }
        mct$audio = AudioCapture.isRequested() ? new GameAudioCapture(mct$soundExecutor) : null;
    }

    @Redirect(method = "init", at = @At(value = "INVOKE",
        target = "Lnet/minecraft/client/sound/SoundEngine;openDeviceOrFallback(Ljava/lang/String;)J"))
    private long mct$openMixDevice(String requestedDevice) {
        if (mct$audio != null) {
            long loopback = mct$audio.open(requestedDevice, mct$directionalAudio);
            if (loopback != 0L) return loopback;
        }
        return openDeviceOrFallback(requestedDevice);
    }

    @Inject(method = "setDirectionalAudio", at = @At("HEAD"), cancellable = true)
    private void mct$keepLoopbackFormat(boolean enabled, CallbackInfo ci) {
        // Vanilla alcResetDeviceSOFT omits mandatory loopback format attributes.
        // The requested HRTF choice is already applied when our context is created.
        if (mct$audio != null && mct$audio.owns(devicePointer)) ci.cancel();
    }

    @Redirect(method = "init", at = @At(value = "INVOKE",
        target = "Lorg/lwjgl/openal/ALC10;alcCreateContext(JLjava/nio/IntBuffer;)J", remap = false))
    private long mct$mixContext(long device, IntBuffer attributes) {
        return mct$audio != null && mct$audio.owns(device)
            ? mct$audio.context(device) : ALC10.alcCreateContext(device, attributes);
    }

    @Inject(method = "init", at = @At("RETURN"))
    private void mct$startAudio(String device, boolean directionalAudio, CallbackInfo ci) {
        if (mct$audio != null) mct$audio.start(devicePointer, contextPointer);
    }

    @Inject(method = "isDeviceUnavailable", at = @At("HEAD"), cancellable = true)
    private void mct$recoverAudio(CallbackInfoReturnable<Boolean> cir) {
        if (mct$audio != null && mct$audio.needsReload()) cir.setReturnValue(true);
    }

    @Inject(method = "getCurrentDeviceName", at = @At("HEAD"), cancellable = true)
    private void mct$reportPlaybackDevice(CallbackInfoReturnable<String> cir) {
        if (mct$audio != null && mct$audio.owns(devicePointer))
            cir.setReturnValue(mct$audio.outputDeviceName());
    }

    @Inject(method = "close", at = @At("HEAD"), cancellable = true)
    private void mct$stopAudio(CallbackInfo ci) {
        if (mct$audio != null) {
            if (!mct$audio.close()) { ci.cancel(); return; }
            mct$audio = null;
        }
    }
}
