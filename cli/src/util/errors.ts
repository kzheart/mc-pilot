export interface ErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export class MctError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly details?: unknown;

  constructor(payload: ErrorPayload, exitCode = 1) {
    super(payload.message);
    this.name = "MctError";
    this.code = payload.code;
    this.exitCode = exitCode;
    this.details = payload.details;
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        details: this.details ?? {}
      }
    };
  }
}

export function normalizeError(error: unknown): MctError {
  if (error instanceof MctError) {
    return error;
  }

  if (error instanceof Error) {
    return new MctError(
      {
        code: "INTERNAL_ERROR",
        message: error.message
      },
      1
    );
  }

  return new MctError(
    {
      code: "INTERNAL_ERROR",
      message: "Unknown error"
    },
    1
  );
}
