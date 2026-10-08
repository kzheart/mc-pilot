import { resolveGlobalStateDir } from "./paths.js";
import { StateStore } from "./state.js";
import type { GlobalClientState } from "./instance-types.js";

const CLIENTS_STATE_FILE = "clients.json";

export class GlobalStateStore extends StateStore {
  constructor() {
    super(resolveGlobalStateDir());
  }

  async withClientLock<T>(task: () => Promise<T>) {
    return this.withLock("clients", task);
  }

  async readClientState(): Promise<GlobalClientState> {
    return this.readJson<GlobalClientState>(CLIENTS_STATE_FILE, {
      clients: {},
    });
  }

  async writeClientState(state: GlobalClientState): Promise<void> {
    await this.writeJson(CLIENTS_STATE_FILE, state);
  }

  async updateClientState<T>(
    mutate: (state: GlobalClientState) => Promise<T> | T,
  ): Promise<T> {
    return this.withClientLock(async () => {
      const state = await this.readClientState();
      const result = await mutate(state);
      await this.writeClientState(state);
      return result;
    });
  }
}
