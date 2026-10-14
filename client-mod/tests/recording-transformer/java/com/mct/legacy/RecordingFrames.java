package com.mct.legacy;
public final class RecordingFrames {
    public static Object last;
    public static int calls;
    public static void onPresent(Object framebuffer) { last = framebuffer; calls++; }
}
