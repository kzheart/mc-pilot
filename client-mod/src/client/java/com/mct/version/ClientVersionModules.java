package com.mct.version;

public record ClientVersionModules(
    TextAdapter text,
    ScoreboardAdapter scoreboard,
    ResourcePackAdapter resourcePack,
    ReconnectAdapter reconnect
) {
}
