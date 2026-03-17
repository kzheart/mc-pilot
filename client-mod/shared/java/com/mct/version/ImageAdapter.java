package com.mct.version;

import net.minecraft.client.texture.NativeImage;

public interface ImageAdapter {

    void setPixel(NativeImage image, int x, int y, int color);

    int getPixel(NativeImage image, int x, int y);
}
