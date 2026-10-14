import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";

import { ClientInstanceManager } from "./ClientInstanceManager.js";
import { GlobalStateStore } from "../util/global-state.js";
import { MctError } from "../util/errors.js";

interface Request {
  id: string;
  action: string;
  params: Record<string, unknown>;
}

async function withClient(
  respond: (request: Request) => Record<string, unknown>,
  run: (manager: ClientInstanceManager, requests: Request[]) => Promise<void>,
) {
  const home = await mkdtemp(path.join(os.tmpdir(), "mct-resourcepack-"));
  const previousHome = process.env.MCT_HOME;
  process.env.MCT_HOME = home;
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  const requests: Request[] = [];
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    server.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const request = JSON.parse(raw.toString()) as Request;
        requests.push(request);
        socket.send(JSON.stringify({ id: request.id, ...respond(request) }));
      });
    });
    const store = new GlobalStateStore();
    await store.writeClientState({
      defaultClient: "bot",
      clients: {
        bot: {
          pid: process.pid,
          name: "bot",
          wsPort: address.port,
          startedAt: new Date().toISOString(),
          logPath: path.join(home, "bot.log"),
          instanceDir: path.join(home, "clients", "bot"),
        },
      },
    });
    await run(new ClientInstanceManager(store), requests);
  } finally {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousHome === undefined) delete process.env.MCT_HOME;
    else process.env.MCT_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
}

function respondWithPack(pack: Record<string, unknown>, inWorld = false) {
  return (request: Request) => {
    if (request.action === "resourcepack.status")
      return { success: true, data: pack };
    if (request.action === "position.get")
      return inWorld
        ? { success: true, data: { x: 1, y: 64, z: 2 } }
        : { success: false, error: "NOT_IN_WORLD" };
    return { success: true, data: { screenCategory: "disconnected" } };
  };
}

function assertNoPackInterruption(requests: Request[]) {
  assert.equal(
    requests.some((request) =>
      [
        "client.reconnect",
        "resourcepack.accept",
        "resourcepack.reject",
      ].includes(request.action),
    ),
    false,
  );
}

test("waitReady does not reconnect while a server pack is pending", async (t) => {
  for (const state of ["accepted", "downloading", "applying"]) {
    await t.test(state, async () => {
      await withClient(
        respondWithPack({
          state,
          pending: true,
          loaded: false,
          policy: "accept",
        }),
        async (manager, requests) => {
          await assert.rejects(
            manager.waitReady("bot", 0.2, {
              reconnectAddress: "localhost:25565",
            }),
            (error) => {
              assert.ok(error instanceof MctError);
              assert.equal(error.code, "TIMEOUT");
              assert.match(
                error.message,
                new RegExp(`resourcePackState=${state}`),
              );
              assert.match(error.message, /resource-pack readiness/);
              return true;
            },
          );
          assertNoPackInterruption(requests);
        },
      );
    });
  }
});

test("waitReady reports an explicit prompt without accepting or reconnecting", async () => {
  await withClient(
    respondWithPack({
      state: "prompt",
      pending: true,
      loaded: false,
      policy: "prompt",
    }),
    async (manager, requests) => {
      await assert.rejects(
        manager.waitReady("bot", 1, { reconnectAddress: "localhost:25565" }),
        (error) => {
          assert.ok(error instanceof MctError);
          assert.equal(error.code, "RESOURCE_PACK_PROMPT");
          assert.match(error.message, /resourcepack accept/);
          assert.match(error.message, /--resource-pack accept/);
          return true;
        },
      );
      assertNoPackInterruption(requests);
    },
  );
});

test("waitReady surfaces a failed download or apply as a terminal error", async () => {
  await withClient(
    respondWithPack(
      {
        state: "failed",
        pending: false,
        loaded: false,
        error: "hash mismatch",
      },
      true,
    ),
    async (manager, requests) => {
      await assert.rejects(manager.waitReady("bot", 1), (error) => {
        assert.ok(error instanceof MctError);
        assert.equal(error.code, "RESOURCE_PACK_FAILED");
        assert.match(error.message, /hash mismatch/);
        return true;
      });
      assertNoPackInterruption(requests);
    },
  );
});

test("waitReady explains rejection of a required pack without reconnecting", async () => {
  await withClient(
    respondWithPack({
      state: "rejected",
      pending: false,
      loaded: false,
      required: true,
    }),
    async (manager, requests) => {
      await assert.rejects(
        manager.waitReady("bot", 1, { reconnectAddress: "localhost:25565" }),
        (error) => {
          assert.ok(error instanceof MctError);
          assert.equal(error.code, "RESOURCE_PACK_REQUIRED_REJECTED");
          assert.match(error.message, /--resource-pack accept/);
          return true;
        },
      );
      assertNoPackInterruption(requests);
    },
  );
});

test("waitReady waits for apply completion even when the player already exists", async () => {
  let observations = 0;
  await withClient(
    (request) =>
      respondWithPack(
        request.action === "resourcepack.status" && ++observations >= 2
          ? { state: "loaded", pending: false, loaded: true }
          : { state: "applying", pending: true, loaded: false },
        true,
      )(request),
    async (manager, requests) => {
      const result = await manager.waitReady("bot", 3, {
        reconnectAddress: "localhost:25565",
      });
      assert.ok("inWorld" in result);
      assert.equal(result.inWorld, true);
      assert.equal(result.resourcePack?.state, "loaded");
      assert.equal(result.resourcePack?.loaded, true);
      assert.equal(observations, 2);
      assertNoPackInterruption(requests);
    },
  );
});

test("unavailable resource-pack observations cannot erase a pending apply", async () => {
  let observations = 0;
  await withClient(
    (request) => {
      if (request.action === "resourcepack.status" && ++observations === 2) {
        return { success: false, error: "INTERNAL_ERROR" };
      }
      return respondWithPack(
        observations >= 3
          ? { state: "loaded", pending: false, loaded: true }
          : { state: "applying", pending: true, loaded: false },
        true,
      )(request);
    },
    async (manager, requests) => {
      const result = await manager.waitReady("bot", 3, {
        reconnectAddress: "localhost:25565",
      });
      assert.ok("resourcePack" in result);
      assert.equal(observations, 3);
      assert.equal(result.resourcePack?.loaded, true);
      assertNoPackInterruption(requests);
    },
  );
});

test("idle, optional rejection and legacy states never fabricate pack-loaded success", async (t) => {
  for (const pack of [
    { state: "idle", pending: false, loaded: false },
    { state: "rejected", pending: false, loaded: false, required: false },
    { acceptanceStatus: "accepted", packCount: 1 },
    { state: "idle", pending: false, loaded: false, lifecycleSupported: false },
    {
      state: "unverified",
      pending: false,
      loaded: false,
      lifecycleSupported: false,
    },
  ]) {
    await t.test(JSON.stringify(pack), async () => {
      await withClient(
        respondWithPack(pack, true),
        async (manager, requests) => {
          const result = await manager.waitReady("bot", 1);
          assert.ok("inWorld" in result);
          assert.equal(result.inWorld, true);
          assert.deepEqual(result.resourcePack, pack);
          assert.equal(
            result.resourcePackReadinessVerified,
            "state" in pack && pack.lifecycleSupported !== false,
          );
          assertNoPackInterruption(requests);
        },
      );
    });
  }
});

test("no-world-check remains WebSocket-only", async () => {
  await withClient(
    respondWithPack({ state: "prompt", pending: true }),
    async (manager, requests) => {
      const result = await manager.waitReady("bot", 1, { requireWorld: false });
      assert.equal(result.connected, true);
      assert.equal(requests.length, 0);
    },
  );
});

test("reconnect transmits explicit policies and preserves absence", async () => {
  await withClient(
    () => ({ success: true, data: { connecting: true } }),
    async (manager, requests) => {
      await manager.reconnect("bot", "localhost:25565");
      for (const policy of ["accept", "prompt", "reject"] as const) {
        await manager.reconnect("bot", "localhost:25565", {
          resourcePackPolicy: policy,
        });
      }
      assert.deepEqual(
        requests.map((request) => request.params),
        [
          { address: "localhost:25565" },
          { address: "localhost:25565", resourcePackPolicy: "accept" },
          { address: "localhost:25565", resourcePackPolicy: "prompt" },
          { address: "localhost:25565", resourcePackPolicy: "reject" },
        ],
      );
    },
  );
});
