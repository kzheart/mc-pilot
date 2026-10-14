package com.mct.audio;

import java.util.concurrent.Executor;

/** Binds the game's source-mutation queue to its recording mixer, without global state. */
public interface GameAudioExecutorBridge {
    void mct$setSoundExecutor(Executor executor);
}
