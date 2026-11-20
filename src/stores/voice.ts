import { create } from "zustand";
import i18n from "../i18n";
import { api } from "../lib/api";
import { errorText } from "../lib/errors";
import { toast } from "./toast";
import { useTasks } from "./tasks";

export interface Block {
  id: string;
  /** Empty means "use the default voice". */
  voiceId: string;
  /** Delivery style in plain words (Gemini only); empty = none. */
  style: string;
  text: string;
}

export interface JobArgs {
  providerId: string;
  lang: string;
  model?: string;
  speed: number;
  pitch?: number;
  gapMs: number;
  /** Whether the engine follows a plain-language style prefix. */
  styleCapable: boolean;
  /** ElevenLabs v3: the chosen emotion is written as a [tag] at the start of the block. */
  tagCapable?: boolean;
  /** Used for Gemini blocks that have no style of their own (automatic emotion). */
  defaultStyle?: string;
}

export interface JobState {
  step: number;
  total: number;
  startedAt: number;
  label: string;
}

interface VoiceState {
  providerId: string;
  /** Default voice for blocks that have none of their own. */
  voiceId: string;
  lang: string;
  blocks: Block[];
  job: JobState | null;
  result: { file: string; chunks: number; parts: number } | null;
  /** Bumped whenever a generation finishes so pages reload their history. */
  doneTick: number;
  set: (patch: Partial<Pick<VoiceState, "providerId" | "voiceId" | "lang">>) => void;
  setBlock: (id: string, patch: Partial<Omit<Block, "id">>) => void;
  addBlock: (after?: string) => void;
  removeBlock: (id: string) => void;
  setScript: (text: string) => void;
  setSegments: (segs: Array<{ text: string; style: string }>) => void;
  run: (a: JobArgs) => Promise<void>;
  cancel: () => void;
  clearResult: () => void;
}

let n = 0;
const newBlock = (text = ""): Block => ({ id: `b${Date.now().toString(36)}${n++}`, voiceId: "", style: "", text });
let token = 0;

export const useVoice = create<VoiceState>((set, get) => ({
  providerId: "",
  voiceId: "",
  lang: "bn-BD",
  blocks: [newBlock()],
  job: null,
  result: null,
  doneTick: 0,
  set: (patch) => set(patch),
  setBlock: (id, patch) => set((s) => ({ blocks: s.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) })),
  addBlock: (after) =>
    set((s) => {
      const i = after ? s.blocks.findIndex((b) => b.id === after) : s.blocks.length - 1;
      const next = [...s.blocks];
      next.splice(i + 1, 0, newBlock());
      return { blocks: next };
    }),
  removeBlock: (id) => set((s) => (s.blocks.length <= 1 ? s : { blocks: s.blocks.filter((b) => b.id !== id) })),
  setScript: (text) => set({ blocks: [newBlock(text)], result: null }),
  setSegments: (segs) =>
    set((s) => {
      const voiceId = s.blocks[0]?.voiceId ?? "";
      return { blocks: segs.map((g) => ({ ...newBlock(g.text), voiceId, style: g.style })), result: null };
    }),
  clearResult: () => set({ result: null }),
  cancel: () => {
    token++;
    set({ job: null });
    toast.info(i18n.t("voice.cancelled"));
  },
  run: async (a) => {
    const st = get();
    const todo = st.blocks.filter((b) => b.text.trim());
    if (todo.length === 0) {
      toast.error(i18n.t("voice.needText"));
      return;
    }
    if (todo.some((b) => !(b.voiceId || st.voiceId).trim())) {
      toast.error(i18n.t("voice.needVoice"));
      return;
    }
    const mine = ++token;
    const taskId = useTasks.getState().start(i18n.t("voice.generate"));
    const startedAt = Date.now();
    const files: string[] = [];
    let chunks = 0;
    try {
      for (let i = 0; i < todo.length; i++) {
        const b = todo[i]!;
        set({ job: { step: i + 1, total: todo.length, startedAt, label: b.text.trim().slice(0, 50) } });
        const text = a.tagCapable && b.style.trim() ? `[${b.style.trim()}] ${b.text}` : b.text;
        const style = a.styleCapable ? b.style.trim() || a.defaultStyle?.trim() || undefined : undefined;
        const out = await api.ttsSynthesize({
          providerId: a.providerId,
          voiceId: (b.voiceId || st.voiceId).trim(),
          lang: a.lang,
          model: a.model,
          text,
          style,
          speed: a.speed,
          pitch: a.pitch,
        });
        if (token !== mine) return;
        files.push(out.file);
        chunks += out.chunks;
      }
      let file = files[0]!;
      if (files.length > 1) {
        set({ job: { step: todo.length, total: todo.length, startedAt, label: i18n.t("voice.joining") } });
        file = await api.audioJoin(files, a.gapMs);
        if (token !== mine) return;
      }
      set((s) => ({ result: { file, chunks, parts: files.length }, doneTick: s.doneTick + 1 }));
      toast.success(i18n.t("voice.doneShort"));
    } catch (e) {
      if (token === mine) {
        toast.error(
          todo.length > 1 && files.length > 0
            ? `${errorText(e)} — ${i18n.t("voice.partFailed", { done: files.length, total: todo.length })}`
            : errorText(e),
        );
      }
    } finally {
      useTasks.getState().end(taskId);
      if (token === mine) set({ job: null });
    }
  },
}));
