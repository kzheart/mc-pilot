package com.mct.version;

import java.util.Map;
import net.minecraft.scoreboard.Scoreboard;

public interface ScoreboardAdapter {

    Map<String, Object> scoreboardStatus(Scoreboard scoreboard);
}
