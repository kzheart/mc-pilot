import { MctError } from "../util/errors.js";
import { MacosSckBackend } from "./MacosSckBackend.js";
import type { RecorderBackend } from "./RecorderBackend.js";

const BACKENDS: Record<string, () => RecorderBackend> = {
  "macos-sck": () => new MacosSckBackend(),
};

function defaultBackendName(): string | undefined {
  if (process.platform === "darwin") {
    return "macos-sck";
  }
  return undefined;
}

export function createRecorderBackend(name?: string): RecorderBackend {
  const backendName = name ?? defaultBackendName();
  if (!backendName) {
    throw new MctError(
      {
        code: "UNSUPPORTED_PLATFORM",
        message: `no recorder backend available for platform ${process.platform}`,
      },
      3,
    );
  }

  const factory = BACKENDS[backendName];
  if (!factory) {
    throw new MctError(
      {
        code: "INVALID_PARAMS",
        message: `unknown recorder backend: ${backendName} (available: ${Object.keys(BACKENDS).join(", ")})`,
      },
      4,
    );
  }

  return factory();
}
