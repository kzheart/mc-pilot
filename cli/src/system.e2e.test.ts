// TODO: Rewrite e2e test for new global instance architecture
// The old test used --config and --state-dir options which no longer exist.
// New test should use MCT_HOME env var and mct.project.json.
import test from "node:test";

test.skip("system e2e: CLI can orchestrate server, client and request flow", () => {
  // Will be rewritten when the full integration is ready
});
