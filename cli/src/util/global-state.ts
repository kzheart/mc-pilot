import { resolveGlobalStateDir } from "./paths.js";
import { StateStore } from "./state.js";
import type { GlobalClientState, GlobalServerState } from "./instance-types.js";

const SERVERS_STATE_FILE = "servers.json";
const CLIENTS_STATE_FILE = "clients.json";

export class GlobalStateStore extends StateStore {
  constructor() {
    super(resolveGlobalStateDir());
  }

  async withClientLock<T>(task: () => Promise<T>) {
    return this.withLock("clients", task);
  }

  async withServerLock<T>(task: () => Promise<T>) {
    return this.withLock("servers", task);
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

  async updateClientState<T>(mutate: (state: GlobalClientState) => Promise<T> | T): Promise<T> {
    return this.withClientLock(async () => {
      const state = await this.readClientState();
      const result = await mutate(state);
      await this.writeClientState(state);
      return result;
    });
  }

  async updateServerState<T>(mutate: (state: GlobalServerState) => Promise<T> | T): Promise<T> {
    return this.withServerLock(async () => {
      const state = await this.readServerState();
      const result = await mutate(state);
      await this.writeServerState(state);
      return result;
    });
  }
}
