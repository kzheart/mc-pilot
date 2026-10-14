import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Socket } from "node:net";

import { WebSocketServer, type WebSocket } from "ws";

import { MctError } from "../util/errors.js";
import { WebSocketClient } from "./WebSocketClient.js";

async function withServer(
  onConnection: (socket: WebSocket) => void,
  run: (client: WebSocketClient) => Promise<void>,
) {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  server.on("connection", onConnection);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(new WebSocketClient(`ws://127.0.0.1:${address.port}`));
  } finally {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function transportError(error: unknown, code: string, phase: string) {
  assert.ok(error instanceof MctError);
  assert.equal(error.code, code);
  const details = error.details as Record<string, unknown>;
  assert.equal(details.phase, phase);
  assert.equal(typeof details.elapsedMs, "number");
  return details;
}

test("WebSocketClient sends request and receives JSON response", async () => {
  await withServer(
    (socket) => {
      socket.on("message", (raw) => {
        const request = JSON.parse(raw.toString());
        socket.send(
          JSON.stringify({ id: request.id, success: true, data: request }),
        );
      });
    },
    async (client) => {
      const response = (await client.send(
        "chat.send",
        { message: "hello" },
        2,
      )) as {
        id: string;
        success: boolean;
        data: { action: string; params: Record<string, unknown> };
      };
      assert.equal(typeof response.id, "string");
      assert.equal(response.success, true);
      assert.equal(response.data.action, "chat.send");
      assert.deepEqual(response.data.params, { message: "hello" });
    },
  );
});

for (const closeNormally of [true, false]) {
  test(`WebSocketClient reports ${closeNormally ? "normal" : "abrupt"} disconnect without waiting for timeout`, async () => {
    await withServer(
      (socket) => {
        socket.once("message", () => {
          if (closeNormally) socket.close(1012, "client restarting");
          else socket.terminate();
        });
      },
      async (client) => {
        await assert.rejects(
          client.send("client.reconnect", {}, 0.25),
          (error) => {
            const details = transportError(
              error,
              "CONNECTION_FAILED",
              "response",
            );
            assert.equal(details.closeCode, closeNormally ? 1012 : 1006);
            assert.equal(
              details.closeReason,
              closeNormally ? "client restarting" : "",
            );
            assert.equal(details.action, "client.reconnect");
            assert.equal(details.requestSent, true);
            assert.equal(details.resultUnknown, true);
            assert.equal(typeof details.requestId, "string");
            return true;
          },
        );
      },
    );
  });
}

test("WebSocketClient ignores other request IDs and waits for its response", async () => {
  await withServer(
    (socket) => {
      socket.once("message", (raw) => {
        const request = JSON.parse(raw.toString());
        socket.send(JSON.stringify({ id: "another-request", success: true }));
        socket.send(
          JSON.stringify({ id: request.id, success: true, data: "correct" }),
        );
      });
    },
    async (client) => {
      const response = (await client.send("status.all", {}, 1)) as {
        data: string;
      };
      assert.equal(response.data, "correct");
    },
  );
});

test("WebSocketClient reports a correlated response timeout and never retries an action", async () => {
  let requests = 0;
  await withServer(
    (socket) => {
      socket.on("message", () => {
        requests++;
        socket.send(JSON.stringify({ id: "other-id", success: true }));
      });
    },
    async (client) => {
      await assert.rejects(
        client.send("client.reconnect", {}, 0.05),
        (error) => {
          const details = transportError(error, "TIMEOUT", "response");
          assert.equal(details.action, "client.reconnect");
          assert.equal(typeof details.requestId, "string");
          assert.equal(details.unmatchedResponses, 1);
          assert.equal(details.lastUnmatchedRequestId, "other-id");
          assert.equal(details.timeoutSeconds, 0.05);
          return true;
        },
      );
      assert.equal(requests, 1);
    },
  );
});

for (const reply of ["not json", "null", "[]", '{"success":true}']) {
  test(`WebSocketClient reports malformed response ${reply}`, async () => {
    await withServer(
      (socket) => socket.once("message", () => socket.send(reply)),
      async (client) => {
        await assert.rejects(client.send("status.all", {}, 0.25), (error) => {
          const details = transportError(error, "INTERNAL_ERROR", "response");
          assert.equal(details.reason, "invalid_response");
          return true;
        });
      },
    );
  });
}

test("WebSocketClient keeps concurrent independent requests isolated", async () => {
  const ids = new Set<string>();
  await withServer(
    (socket) => {
      socket.once("message", (raw) => {
        const request = JSON.parse(raw.toString());
        ids.add(request.id);
        setTimeout(
          () => {
            socket.send(
              JSON.stringify({
                id: request.id,
                success: true,
                data: request.params,
              }),
            );
          },
          (19 - request.params.index) % 5,
        );
      });
    },
    async (client) => {
      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          client.send("status.all", { index }, 2),
        ),
      );
      assert.equal(ids.size, 20);
      responses.forEach((response, index) => {
        assert.deepEqual((response as { data: unknown }).data, { index });
      });
    },
  );
});

test("WebSocketClient distinguishes a stalled handshake from a response timeout", async () => {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const client = new WebSocketClient(`ws://127.0.0.1:${address.port}`);
    await assert.rejects(client.send("status.all", {}, 0.05), (error) => {
      const details = transportError(error, "TIMEOUT", "connect");
      assert.equal(details.action, "status.all");
      assert.equal(details.requestSent, false);
      assert.equal(details.resultUnknown, false);
      return true;
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("WebSocketClient ping remains a handshake-only readiness check", async () => {
  let requests = 0;
  await withServer(
    (socket) => socket.on("message", () => requests++),
    async (client) => {
      const response = await client.ping(1);
      assert.equal(response.connected, true);
      assert.equal(requests, 0);
    },
  );
});

test("WebSocketClient preserves protocol-level TIMEOUT responses separately from transport failures", async () => {
  await withServer(
    (socket) => {
      socket.once("message", (raw) => {
        const request = JSON.parse(raw.toString());
        socket.send(
          JSON.stringify({ id: request.id, success: false, error: "TIMEOUT" }),
        );
      });
    },
    async (client) => {
      const response = (await client.send("gui.wait-update", {}, 1)) as {
        success: boolean;
        error: string;
      };
      assert.equal(response.success, false);
      assert.equal(response.error, "TIMEOUT");
    },
  );
});

test("WebSocketClient bounds a close handshake when the peer never acknowledges it", async () => {
  let closed: Promise<unknown>;
  await withServer(
    (socket) => {
      closed = once(socket, "close");
      // Simulate a peer that receives a close frame but never sends one back.
      socket.close = () => {};
      socket.once("message", (raw) => {
        const request = JSON.parse(raw.toString());
        socket.send(JSON.stringify({ id: request.id, success: true }));
      });
    },
    async (client) => {
      await client.send("status.all", {}, 1);
      let timeout: ReturnType<typeof setTimeout>;
      try {
        await Promise.race([
          closed!,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("close handshake did not finish")),
              3000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout!);
      }
    },
  );
});

for (const timeout of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 86_401]) {
  test(`WebSocketClient rejects invalid timeout ${timeout} before opening a socket`, async () => {
    const client = new WebSocketClient("ws://127.0.0.1:1");
    await assert.rejects(client.send("status.all", {}, timeout), (error) => {
      assert.ok(error instanceof MctError);
      assert.equal(error.code, "INVALID_PARAMS");
      return true;
    });
  });
}

test("WebSocketClient sends a relative millisecond budget, preserving older mod envelopes", async () => {
  await withServer(
    (socket) =>
      socket.once("message", (raw) => {
        const request = JSON.parse(raw.toString());
        assert.equal(request.timeoutMs, 1250);
        socket.send(
          JSON.stringify({ id: request.id, success: true, data: {} }),
        );
      }),
    async (client) => {
      await client.send("status.all", {}, 1.25);
    },
  );
});
