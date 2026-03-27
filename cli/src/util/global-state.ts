import { resolveGlobalStateDir } from "./paths.js";
import { StateStore } from "./state.js";
import type { GlobalClientState, GlobalServerState } from "./instance-types.js";

const SERVERS_STATE_FILE = "servers.json";
const CLIENTS_STATE_FILE = "clients.json";

export class GlobalStateStore extends StateStore {
  constructor() {
    super(resolveGlobalStateDir());
  }

  async readServerState(): Promise<GlobalServerState> {
    return this.readJson<GlobalServerState>(SERVERS_STATE_FILE, { servers: {} });
  }

  async writeServerState(state: GlobalServerState): Promise<void> {
    await this.writeJson(SERVERS_STATE_FILE, state);
  }

  async readClientState(): Promise<GlobalClientState> {
    return this.readJson<GlobalClientState>(CLIENTS_STATE_FILE, { clients: {} });
  }

  async writeClientState(state: GlobalClientState): Promise<void> {
    await this.writeJson(CLIENTS_STATE_FILE, state);
  }
}
