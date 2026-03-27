export const IPC_CHANNELS = {
  GET_SERVER_STATE: "get-server-state",
  GET_CLIENT_STATE: "get-client-state",
  GET_PROJECTS: "get-projects",
  GET_CLIENT_INSTANCES: "get-client-instances",
  EXEC_MCT: "exec-mct",
  STATE_CHANGED: "state-changed",
  TAIL_LOG: "tail-log",
  TAIL_LOG_LINE: "tail-log-line",
  SELECT_FILE: "select-file"
} as const;
