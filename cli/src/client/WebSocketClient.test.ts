import test from "node:test";
import assert from "node:assert/strict";

import { WebSocketServer } from "ws";

import { WebSocketClient } from "./WebSocketClient.js";

test("WebSocketClient sends request and receives JSON response", async () => {
  const server = new WebSocketServer({ port: 25593 });

  server.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const request = JSON.parse(raw.toString());
      socket.send(
        JSON.stringify({
          id: request.id,
          success: true,
          data: {
            echoedAction: request.action,
            params: request.params
          }
        })
      );
    });
  });

  try {
    const client = new WebSocketClient("ws://127.0.0.1:25593");
    const response = await client.send("chat.send", { message: "hello" }, 2);
    const parsed = response as {
      id: string;
      success: boolean;
      data: {
        echoedAction: string;
        params: {
          message: string;
        };
      };
    };

    assert.equal(typeof parsed.id, "string");
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.echoedAction, "chat.send");
    assert.deepEqual(parsed.data.params, { message: "hello" });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});
