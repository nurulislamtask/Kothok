import { create } from "zustand";
import { api, isReady, type DefaultRow, type FallbackRow, type Provider } from "../lib/api";
import { isTauri } from "../lib/ipc";

interface ProvidersState {
  providers: Provider[];
  defaults: DefaultRow[];
  chains: FallbackRow[];
  loaded: boolean;
  refresh: () => Promise<void>;
}

export const useProviders = create<ProvidersState>((set) => ({
  providers: [],
  defaults: [],
  chains: [],
  loaded: false,
  refresh: async () => {
    if (!isTauri()) {
      set({ loaded: true });
      return;
    }
    try {
      const [providers, defaults, chains] = await Promise.all([
        api.listProviders(),
        api.getDefaults(),
        api.getFallbackChains(),
      ]);
      set({ providers, defaults, chains, loaded: true });
    } catch (e) {
      console.error("Failed to load providers", e);
      set({ loaded: true });
    }
  },
}));

/** The default provider for a category, only if it can actually be used. */
export function defaultProvider(
  s: Pick<ProvidersState, "providers" | "defaults">,
  category: Provider["category"],
): Provider | undefined {
  const id = s.defaults.find((d) => d.category === category)?.providerId;
  const p = s.providers.find((x) => x.id === id);
  return p && isReady(p) ? p : undefined;
}
