import com.mct.core.resourcepack.ResourcePackLifecycle;
import com.mct.core.resourcepack.ResourcePackPolicy;
import java.util.Map;

public final class ResourcePackLifecycleTest {
    private static int checks;
    public static void main(String[] args) {
        eq("accept", ResourcePackPolicy.resolve(null, null, false));
        eq("reject", ResourcePackPolicy.resolve(null, null, true));
        eq("prompt", ResourcePackPolicy.resolve(null, "prompt", false));
        eq("accept", ResourcePackPolicy.resolve("accept", "reject", true));
        eq("reject", ResourcePackPolicy.resolve("reject", "accept", false));
        try { ResourcePackPolicy.parse("bogus"); throw new AssertionError("Invalid policy accepted"); }
        catch (IllegalArgumentException expected) { checks++; }

        ResourcePackLifecycle state = new ResourcePackLifecycle();
        state.reset("accept");
        eq("idle", state.snapshot().get("state"));
        eq(false, state.snapshot().get("loaded"));
        state.managerState("allowed", 0);
        eq(false, state.snapshot().get("loaded"));
        state.offered("a", true);
        state.status("a", "ACCEPTED");
        eq("downloading", state.snapshot().get("state"));
        eq(true, state.snapshot().get("pending"));
        state.status("a", "DOWNLOADED");
        eq("applying", state.snapshot().get("state"));
        eq(false, state.snapshot().get("loaded"));
        state.status("a", "SUCCESSFULLY_LOADED");
        eq("loaded", state.snapshot().get("state"));
        eq(true, state.snapshot().get("loaded"));
        state.offered("b", false);
        state.status("b", "ACCEPTED");
        eq("downloading", state.snapshot().get("state"));
        eq(false, state.snapshot().get("loaded"));
        state.status("b", "DECLINED");
        eq("rejected", state.snapshot().get("state"));
        eq(false, state.snapshot().get("required"));
        state.offered("a", true);
        eq(false, state.snapshot().get("loaded"));
        state.status("a", "DECLINED");
        eq("rejected", state.snapshot().get("state"));
        eq(true, state.snapshot().get("required"));
        state.offered("a", true);
        state.status("a", "FAILED_DOWNLOAD");
        eq("failed", state.snapshot().get("state"));
        eq("failed_download", state.snapshot().get("error"));
        state.offered("a", true);
        eq(false, state.snapshot().containsKey("error"));
        state.status("a", "ACCEPTED");
        state.status("a", "SUCCESSFULLY_LOADED");
        state.remove("b");
        eq("loaded", state.snapshot().get("state"));
        state.offered("a", true);
        state.status("a", "DISCARDED"); // Previous copy replaced with same UUID.
        state.status("a", "ACCEPTED");
        eq("downloading", state.snapshot().get("state"));
        state.status("a", "DISCARDED");
        eq("idle", state.snapshot().get("state"));
        state.status("a", "SUCCESSFULLY_LOADED"); // Removed/stale callback cannot resurrect a pack.
        eq("idle", state.snapshot().get("state"));
        state.offered("old", true);
        state.reset("prompt");
        state.status("old", "SUCCESSFULLY_LOADED");
        eq("idle", state.snapshot().get("state"));
        state.offered("c", true);
        state.prompt(true);
        eq("prompt", state.snapshot().get("state"));
        eq(true, state.snapshot().get("pendingPrompt"));
        state.removeAll();
        eq("idle", state.snapshot().get("state"));
        eq(false, state.snapshot().get("pending"));
        for (String pending : new String[] {"prompt", "accepted", "downloading", "applying", "failed"}) {
            eq(true, ResourcePackLifecycle.blocksAutoReconnect(map("state", pending)));
        }
        eq(true, ResourcePackLifecycle.blocksAutoReconnect(map("state", "rejected", "required", true)));
        eq(false, ResourcePackLifecycle.blocksAutoReconnect(map("state", "rejected", "required", false)));
        eq(false, ResourcePackLifecycle.blocksAutoReconnect(map("state", "loaded")));
        eq(false, ResourcePackLifecycle.blocksAutoReconnect(map("state", "idle")));
        ResourcePackLifecycle legacy = new ResourcePackLifecycle();
        legacy.reset("accept");
        legacy.offered("http", false);
        legacy.status("http", "ACCEPTED");
        legacy.unverified("http");
        eq("unverified", legacy.snapshot().get("state"));
        eq(false, legacy.snapshot().get("pending"));
        eq(false, legacy.snapshot().get("loaded"));
        eq(false, legacy.snapshot().get("lifecycleSupported"));
        eq("allowed", legacy.snapshot().get("acceptanceStatus"));
        legacy.offered("next", false);
        eq("accepted", legacy.snapshot().get("state"));
        legacy.status("next", "ACCEPTED");
        eq("downloading", legacy.snapshot().get("state"));
        legacy.status("next", "FAILED_DOWNLOAD"); // Disconnect/cancellation remains terminal.
        legacy.prompt(false);
        eq("failed", legacy.snapshot().get("state"));
        eq(false, legacy.snapshot().get("pending"));
        legacy.reset("prompt");
        legacy.unverified("http"); // Stale transport completion must not recreate an offer.
        eq("idle", legacy.snapshot().get("state"));

        System.out.println("Resource-pack lifecycle/policy checks passed: " + checks);
    }

    private static Map<String, Object> map(Object... entries) {
        Map<String, Object> result = new java.util.LinkedHashMap<String, Object>();
        for (int i = 0; i < entries.length; i += 2) result.put((String) entries[i], entries[i + 1]);
        return result;
    }

    private static void eq(Object expected, Object actual) {
        checks++;
        if (!expected.equals(actual)) throw new AssertionError("Expected " + expected + ", got " + actual);
    }
}
