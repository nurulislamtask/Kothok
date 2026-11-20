import { create } from "zustand";
import { api, isReady, keyFrom, type DefaultRow, type FallbackRow, type Provider } from "../lib/api";
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
      void autoShareFreeKeys(providers, () => useProviders.getState().refresh());
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

let autoRan = false;

/**
 * A Gemini key also does speech and transcription, so connect those jobs once without asking again.
 * Images are left out on purpose: Gemini image generation can cost money, so that stays a choice.
 */
async function autoShareFreeKeys(providers: Provider[], reload: () => Promise<void>): Promise<void> {
  if (autoRan) return;
  autoRan = true;
  let linked = 0;
  for (const p of providers) {
    if (!p.hasKey || keyFrom(p) || p.adapter !== "gemini") continue;
    for (const c of ["tts", "stt"] as const) {
      const exists = providers.some((q) => q.category === c && (q.id === p.id || keyFrom(q) === p.id));
      if (exists) continue;
      try {
        await api.linkProvider(p.id, c);
        linked++;
      } catch (e) {
        console.error("auto link failed", e);
      }
    }
  }
  if (linked > 0) {
    await reload();
    const { toast } = await import("./toast");
    const { default: i18n } = await import("../i18n");
    toast.success(i18n.t("need.autoLinked"));
  }
}
