import { create } from "zustand";
import type { Asset } from "../lib/api";
import type { Settings } from "../features/content/prompts";

export interface ContentSettings extends Settings {
  providerId: string;
  model: string;
  allowFallback: boolean;
}

interface ContentState {
  settings: ContentSettings;
  title: string;
  body: string;
  projectId: number | null;
  assetId: number | null;
  dirty: boolean;
  history: string[];
  lastGenerated: boolean;
  note: { kind: "ok" | "fallback"; provider: string; model: string } | null;

  patchSettings: (p: Partial<ContentSettings>) => void;
  setTitle: (t: string) => void;
  setBody: (b: string) => void;
  /** Replace the body from an AI result, remembering the previous text for Undo. */
  applyAi: (next: string) => void;
  undo: () => void;
  markSaved: (assetId: number, projectId: number | null, title: string) => void;
  setNote: (n: ContentState["note"]) => void;
  setLastGenerated: (v: boolean) => void;
  reset: () => void;
  loadAsset: (a: Asset) => void;
}

const DEFAULT_SETTINGS: ContentSettings = {
  contentType: "youtube_script",
  lang: "bn",
  tone: "friendly",
  style: "conversational",
  length: "medium",
  audience: "",
  platform: "none",
  instructions: "",
  topic: "",
  providerId: "",
  model: "",
  allowFallback: false,
};

const MAX_HISTORY = 20;

export const useContent = create<ContentState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  title: "",
  body: "",
  projectId: null,
  assetId: null,
  dirty: false,
  history: [],
  lastGenerated: false,
  note: null,

  patchSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
  setTitle: (title) => set({ title, dirty: true }),
  setBody: (body) => set({ body, dirty: true }),
  applyAi: (next) => {
    const { body, history } = get();
    set({ body: next, dirty: true, history: [...history, body].slice(-MAX_HISTORY) });
  },
  undo: () => {
    const { history } = get();
    const prev = history[history.length - 1];
    if (prev === undefined) return;
    set({ body: prev, history: history.slice(0, -1), dirty: true });
  },
  markSaved: (assetId, projectId, title) => set({ assetId, projectId, title, dirty: false }),
  setNote: (note) => set({ note }),
  setLastGenerated: (lastGenerated) => set({ lastGenerated }),
  reset: () =>
    set({ title: "", body: "", projectId: null, assetId: null, dirty: false, history: [], lastGenerated: false, note: null }),
  loadAsset: (a) =>
    set({
      title: a.title ?? "",
      body: a.body ?? "",
      projectId: a.projectId,
      assetId: a.id,
      dirty: false,
      history: [],
      lastGenerated: false,
      note: null,
    }),
}));
