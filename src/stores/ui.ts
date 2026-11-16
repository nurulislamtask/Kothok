import { create } from "zustand";
import i18n from "../i18n";
import { getSetting, setSetting } from "../lib/ipc";
import type { RouteId } from "../app/nav";

export type Theme = "dark" | "light";
export type UiLang = "en" | "bn";

interface Persisted {
  theme: Theme;
  uiLang: UiLang;
}

interface UiState extends Persisted {
  route: RouteId;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  setUiLang: (lang: UiLang) => void;
  setRoute: (route: RouteId) => void;
}

const SETTINGS_KEY = "ui";
const DEFAULTS: Persisted = { theme: "dark", uiLang: "en" };

function applyToDocument(p: Persisted): void {
  const root = document.documentElement;
  root.classList.toggle("dark", p.theme === "dark");
  root.classList.toggle("light", p.theme === "light");
  root.lang = p.uiLang;
  void i18n.changeLanguage(p.uiLang);
}

function persist(p: Persisted): void {
  applyToDocument(p);
  setSetting(SETTINGS_KEY, JSON.stringify(p)).catch((e: unknown) =>
    console.error("Failed to save UI settings", e),
  );
}

export const useUi = create<UiState>((set, get) => ({
  ...DEFAULTS,
  route: "dashboard",
  hydrated: false,

  hydrate: async () => {
    const next: Persisted = { ...DEFAULTS };
    try {
      const raw = await getSetting(SETTINGS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Persisted>;
        if (saved.theme === "dark" || saved.theme === "light") next.theme = saved.theme;
        if (saved.uiLang === "en" || saved.uiLang === "bn") next.uiLang = saved.uiLang;
      }
    } catch (e) {
      console.error("Failed to load UI settings, using defaults", e);
    }
    applyToDocument(next);
    set({ ...next, hydrated: true });
  },

  setTheme: (theme) => {
    set({ theme });
    persist({ theme, uiLang: get().uiLang });
  },
  setUiLang: (uiLang) => {
    set({ uiLang });
    persist({ theme: get().theme, uiLang });
  },
  setRoute: (route) => set({ route }),
}));
