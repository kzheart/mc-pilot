package com.mct.core.util;

public final class ThreadUtil {

    private ThreadUtil() {
    }

    public static void runOnClientThread(Runnable runnable) {
        runnable.run();
    }
}
