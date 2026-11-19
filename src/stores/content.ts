import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import i18n from "../i18n";
import { api, type Asset } from "../lib/api";
import { errorCode, errorDetail, errorText } from "../lib/errors";
import { buildPrompt, type Op, type Settings } from "../features/content/prompts";
import { useTasks } from "./tasks";
import { toast } from "./toast";

export interface ContentSettings extends Settings {
  providerId: string;
  model: string;
  allowFallback: boolean;
}

/** Everything needed to run (or re-run after a paid-provider confirmation) one AI operation. */
export interface RunArgs {
  op: Op;
  providerId?: string;
  targetLang: "bn" | "en";
  /** Selected range in the editor at the moment the button was pressed. */
  start: number;
  end: number;
}

export interface LiveRun {
  op: Op;
  text: string;
  provider: string;
  model: string;
}

interface ContentState {
  /** Running operation. Lives here (not in the page) so it survives switching sections. */
  live: LiveRun | null;
  paid: { args: RunArgs; providerId: string } | null;
  allowPaid: string[];
  run: (args: RunArgs, confirmedPaid?: string[]) => Promise<void>;
  stop: () => void;
  clearPaid: () => void;
  confirmPaid: () => void;
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

let runToken = 0;

export const useContent = create<ContentState>((set, get) => ({
  live: null,
  paid: null,
  allowPaid: [],
  clearPaid: () => set({ paid: null }),
  confirmPaid: () => {
    const p = get().paid;
    if (!p) return;
    const next = [...get().allowPaid, p.providerId];
    set({ paid: null, allowPaid: next });
    void get().run(p.args, next);
  },
  stop: () => {
    runToken++;
    set({ live: null });
    toast.info(i18n.t("content.stopped"));
  },
  run: async (args, confirmedPaid) => {
    const st = get();
    const { op } = args;
    const selection = args.end > args.start ? st.body.slice(args.start, args.end) : "";
    const bodyAtStart = st.body;
    if (op === "generate" && !st.settings.topic.trim()) {
      toast.error(i18n.t("content.needTopic"));
      return;
    }
    if (op !== "generate" && !st.body.trim()) {
      toast.error(i18n.t("content.needText"));
      return;
    }
    const built = buildPrompt(op, st.settings, { body: st.body, selection, targetLang: args.targetLang });
    const token = ++runToken;
    const streamId = `c${token}-${Date.now()}`;
    set({ live: { op, text: "", provider: "", model: "" } });
    const taskId = useTasks.getState().start(i18n.t(`content.ops.${op}`));
    const unlisten = await listen<{ streamId: string; text: string; reset: boolean; providerName: string; model: string }>(
      "ai-chunk",
      (ev) => {
        const d = ev.payload;
        if (d.streamId !== streamId || runToken !== token) return;
        set((s) =>
          s.live
            ? { live: { ...s.live, text: d.reset ? "" : s.live.text + d.text, provider: d.providerName, model: d.model } }
            : s,
        );
      },
    ).catch(() => () => undefined);
    try {
      const out = await api.generate({
        providerId: args.providerId,
        model: st.settings.model.trim() || undefined,
        system: built.system,
        prompt: built.prompt,
        allowFallback: st.settings.allowFallback,
        allowPaid: confirmedPaid ?? get().allowPaid,
        streamId,
      });
      if (runToken !== token) return;
      const text = out.text.trim();
      const cur = get();
      if (op === "generate") {
        cur.applyAi(text);
        set({ lastGenerated: true });
      } else if (op === "continue") {
        cur.applyAi(`${cur.body.replace(/\s+$/, "")}\n\n${text}`);
      } else if (selection) {
        if (cur.body === bodyAtStart) {
          cur.applyAi(cur.body.slice(0, args.start) + text + cur.body.slice(args.end));
        } else {
          const idx = cur.body.indexOf(selection);
          cur.applyAi(
            idx >= 0 ? cur.body.slice(0, idx) + text + cur.body.slice(idx + selection.length) : `${cur.body}\n\n${text}`,
          );
        }
      } else {
        cur.applyAi(text);
      }
      set({ note: { kind: out.fellBack ? "fallback" : "ok", provider: out.providerName, model: out.model } });
    } catch (e) {
      if (runToken !== token) return;
      if (errorCode(e) === "needs_confirmation") {
        set({ paid: { args, providerId: errorDetail(e) ?? "" } });
      } else {
        toast.error(errorText(e));
      }
    } finally {
      unlisten();
      useTasks.getState().end(taskId);
      if (runToken === token) set({ live: null });
    }
  },
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
