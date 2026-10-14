package com.mct.core.handler;
import com.mct.test.WebSocketRegressionHarness;
import java.util.Map;
public final class ActionDispatcher {
    public ActionDispatcher(Object client) {}
    public Map<String, Object> execute(String action, Map<String, Object> params) throws Exception {
        return WebSocketRegressionHarness.execute(action, params);
    }
}
