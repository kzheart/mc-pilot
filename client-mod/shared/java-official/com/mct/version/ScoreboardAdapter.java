package com.mct.version;

import java.util.Map;
import net.minecraft.world.scores.Scoreboard;

public interface ScoreboardAdapter {

    Map<String, Object> scoreboardStatus(Scoreboard scoreboard);
}
