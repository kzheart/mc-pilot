import { randomUUID } from "node:crypto";

import WebSocket, { type RawData } from "ws";

import { MctError, invalidParams } from "../util/errors.js";

export interface WsRequest {
  id: string;
  action: string;
  params?: Record<string, unknown>;
  timeoutMs?: number;
}

export class WebSocketClient {
  constructor(private readonly url: string) {}

  async send(
    action: string,
    params: Record<string, unknown> = {},
    timeoutSeconds = 10,
  ) {
    return this.exchange(timeoutSeconds, { id: randomUUID(), action, params });
  }

  async ping(timeoutSeconds = 10) {
    await this.exchange(timeoutSeconds);
    return { connected: true, url: this.url };
  }

  // One owner for the whole socket lifecycle: no gap between the handshake and
  // response listeners, and every terminal event clears the same timeout.
  private exchange(timeoutSeconds: number, request?: WsRequest) {
    if (
      !Number.isFinite(timeoutSeconds) ||
      timeoutSeconds <= 0 ||
      timeoutSeconds > 86_400
    ) {
      throw invalidParams(
        "WebSocket timeout must be positive and no greater than 86400 seconds",
      );
    }

    return new Promise<unknown>((resolve, reject) => {
      const startedAt = performance.now();
      const socket = new WebSocket(this.url);
      let phase: "connect" | "response" = "connect";
      let settled = false;
      let requestSent = false;
      let unmatchedResponses = 0;
      let lastUnmatchedRequestId: string | undefined;
      let timeout: ReturnType<typeof setTimeout>;

      const fail = (
        code: string,
        message: string,
        extra: Record<string, unknown> = {},
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(
          new MctError(
            {
              code,
              message,
              details: {
                url: this.url,
                phase,
                requestId: request?.id,
                action: request?.action,
                requestSent,
                resultUnknown: requestSent,
                elapsedMs: Math.round(performance.now() - startedAt),
                timeoutSeconds,
                unmatchedResponses,
                lastUnmatchedRequestId,
                ...extra,
              },
            },
            code === "TIMEOUT" ? 2 : 1,
          ),
        );
        // Keep the error listener installed: terminating a CONNECTING socket
        // emits an error asynchronously. It must not become an uncaught error.
        socket.terminate();
      };

      const armTimeout = () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          fail(
            "TIMEOUT",
            phase === "connect"
              ? `Timed out connecting to ${this.url}`
              : `Timed out waiting for response from ${this.url}`,
          );
        }, timeoutSeconds * 1000);
      };

      const succeed = (response?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(response);
        socket.close();
        // A peer that never acknowledges close must not keep a one-shot CLI
        // alive for ws's default 30-second close handshake timeout.
        const closeTimeout = setTimeout(() => socket.terminate(), 1_000);
        closeTimeout.unref();
        socket.once("close", () => clearTimeout(closeTimeout));
      };

      socket.once("open", () => {
        if (settled) return;
        if (!request) {
          succeed();
          return;
        }
        phase = "response";
        armTimeout();
        try {
          socket.send(
            JSON.stringify({
              ...request,
              timeoutMs: Math.ceil(timeoutSeconds * 1000),
            }),
            (error) => {
              if (error)
                fail(
                  "CONNECTION_FAILED",
                  `Unable to send request to ${this.url}`,
                  { reason: error.message },
                );
            },
          );
          requestSent = true;
        } catch (error) {
          fail("CONNECTION_FAILED", `Unable to send request to ${this.url}`, {
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      });

      socket.on("message", (data: RawData) => {
        if (settled || !request) return;
        let response: unknown;
        try {
          response = JSON.parse(data.toString());
        } catch {
          fail(
            "INTERNAL_ERROR",
            `Invalid WebSocket response from ${this.url}`,
            { reason: "invalid_response" },
          );
          return;
        }
        if (
          !response ||
          typeof response !== "object" ||
          !("id" in response) ||
          typeof response.id !== "string"
        ) {
          fail(
            "INTERNAL_ERROR",
            `Invalid WebSocket response from ${this.url}`,
            { reason: "invalid_response" },
          );
          return;
        }
        if (response.id !== request.id) {
          unmatchedResponses++;
          lastUnmatchedRequestId = response.id;
          return;
        }
        succeed(response);
      });

      socket.on("error", (error: Error) => {
        fail(
          "CONNECTION_FAILED",
          `WebSocket connection failed at ${this.url}`,
          { reason: error.message },
        );
      });

      socket.once("close", (code: number, reason: Buffer) => {
        fail(
          "CONNECTION_FAILED",
          `WebSocket closed before ${phase === "connect" ? "connecting" : "responding"} at ${this.url}`,
          {
            closeCode: code,
            closeReason: reason.toString(),
          },
        );
      });

      armTimeout();
    });
  }
}
