import { create } from "zustand";
import type { Asset } from "../lib/api";
import { parseSubtitles, type Segment } from "../features/subtitles/srt";

interface SubState {
  segs: Segment[];
  title: string;
  lang: string | null;
  projectId: number | null;
  assetId: number | null;
  dirty: boolean;
  setSegs: (segs: Segment[]) => void;
  /** Replace everything with a new subtitle set (from a file, a transcription or a project). */
  load: (segs: Segment[], title: string, lang?: string | null) => void;
  loadAsset: (a: Asset) => void;
  setTitle: (t: string) => void;
  markSaved: (assetId: number, projectId: number | null, title: string) => void;
}

export const useSubs = create<SubState>((set) => ({
  segs: [],
  title: "",
  lang: null,
  projectId: null,
  assetId: null,
  dirty: false,
  setSegs: (segs) => set({ segs, dirty: true }),
  load: (segs, title, lang = null) => set({ segs, title, lang, projectId: null, assetId: null, dirty: false }),
  loadAsset: (a) =>
    set({
      segs: parseSubtitles(a.body ?? ""),
      title: a.title ?? "",
      lang: a.lang,
      projectId: a.projectId,
      assetId: a.id,
      dirty: false,
    }),
  setTitle: (title) => set({ title, dirty: true }),
  markSaved: (assetId, projectId, title) => set({ assetId, projectId, title, dirty: false }),
}));
