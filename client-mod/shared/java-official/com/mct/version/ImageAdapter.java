package com.mct.version;

import com.mojang.blaze3d.platform.NativeImage;

public interface ImageAdapter {

    void setPixel(NativeImage image, int x, int y, int color);

    int getPixel(NativeImage image, int x, int y);
}
