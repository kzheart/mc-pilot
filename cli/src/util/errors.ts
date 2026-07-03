export interface ErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export const ERROR_CODES = {
  INTERNAL_ERROR: "INTERNAL_ERROR",
  INVALID_PARAMS: "INVALID_PARAMS",
  NO_PROJECT: "NO_PROJECT",
  NO_PROFILE: "NO_PROFILE",
} as const;

export const ERROR_MESSAGES = {
  CLIENT_NAME_REQUIRED:
    "Client name is required. Use --client <name> or set an active profile.",
  SERVER_NAME_REQUIRED:
    "Server name is required. Specify it as argument or set a profile.",
  NO_PROJECT_CONTEXT: "No project context. Run 'mct init' first.",
  NO_PROFILE_SELECTED: "No profile specified and no defaultProfile set",
  OUTPUT_REQUIRED: "--output is required outside a project context.",
} as const;

export function invalidParams(message: string, details?: unknown): MctError {
  return new MctError(
    { code: ERROR_CODES.INVALID_PARAMS, message, details },
    4,
  );
}

export function noProject(
  message: string = ERROR_MESSAGES.NO_PROJECT_CONTEXT,
  details?: unknown,
): MctError {
  return new MctError({ code: ERROR_CODES.NO_PROJECT, message, details }, 4);
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
        details: this.details ?? {},
      },
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
        message: error.message,
      },
      1,
    );
  }

  return new MctError(
    {
      code: "INTERNAL_ERROR",
      message: "Unknown error",
    },
    1,
  );
}
