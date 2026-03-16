import net from "node:net";

import { MctError } from "./errors.js";

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function waitForTcpPort(host: string, port: number, timeoutSeconds: number) {
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const reachable = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });

      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });

      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });

    if (reachable) {
      return {
        reachable: true,
        host,
        port
      };
    }

    await wait(500);
  }

  throw new MctError(
    {
      code: "TIMEOUT",
      message: `Timed out waiting for ${host}:${port}`
    },
    2
  );
}
