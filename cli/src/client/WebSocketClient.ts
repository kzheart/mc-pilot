import { randomUUID } from "node:crypto";

import WebSocket, { type RawData } from "ws";

import { MctError } from "../util/errors.js";

export interface WsRequest {
  id: string;
  action: string;
  params?: Record<string, unknown>;
}

export class WebSocketClient {
  constructor(private readonly url: string) {}

  async send(action: string, params: Record<string, unknown> = {}, timeoutSeconds = 10) {
    const request: WsRequest = {
      id: randomUUID(),
      action,
      params
    };

    const socket = await this.connect(timeoutSeconds);

    try {
      const response = await new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(
            new MctError(
              {
                code: "TIMEOUT",
                message: `Timed out waiting for response from ${this.url}`
              },
              2
            )
          );
        }, timeoutSeconds * 1000);

        socket.once("message", (data: RawData) => {
          clearTimeout(timeout);
          try {
            resolve(JSON.parse(data.toString()));
          } catch (error) {
            reject(error);
          }
        });

        socket.once("error", (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        });

        socket.send(JSON.stringify(request));
      });

      return response;
    } finally {
      socket.close();
    }
  }

  async ping(timeoutSeconds = 10) {
    const socket = await this.connect(timeoutSeconds);
    socket.close();
    return {
      connected: true,
      url: this.url
    };
  }

  private async connect(timeoutSeconds: number) {
    return new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      const timeout = setTimeout(() => {
        socket.terminate();
        reject(
          new MctError(
            {
              code: "TIMEOUT",
              message: `Timed out connecting to ${this.url}`
            },
            2
          )
        );
      }, timeoutSeconds * 1000);

      socket.once("open", () => {
        clearTimeout(timeout);
        resolve(socket);
      });

      socket.once("error", () => {
        clearTimeout(timeout);
        reject(
          new MctError(
            {
              code: "CONNECTION_FAILED",
              message: `Unable to connect to ${this.url}`
            },
            1
          )
        );
      });
    });
  }
}
