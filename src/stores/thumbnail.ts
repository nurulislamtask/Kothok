import { create } from "zustand";
import type { ImageSource } from "../features/thumbnail/render";
import {
  DEFAULT_BACKGROUND,
  type Background,
  type Doc,
  type Layer,
  type SizePreset,
} from "../features/thumbnail/model";

const MAX_HISTORY = 40;

interface ThumbState {
  doc: Doc;
  images: Record<string, ImageSource>;
  selectedId: string | null;
  past: Doc[];
  future: Doc[];
  lastPush: number;
  /** Asset this design was saved as, so Save updates instead of duplicating. */
  assetId: number | null;
  projectId: number | null;
  title: string;
  /** Bumped when an image finishes decoding so the canvas redraws. */
  tick: number;

  select: (id: string | null) => void;
  /** Record the current document so the next change can be undone. */
  checkpoint: (force?: boolean) => void;
  addLayer: (l: Layer) => void;
  patchLayer: (id: string, patch: Partial<Layer>) => void;
  removeLayer: (id: string) => void;
  moveLayer: (id: string, dir: -1 | 1) => void;
  duplicateLayer: (id: string) => void;
  setBackground: (b: Background) => void;
  setSize: (p: Pick<SizePreset, "width" | "height">) => void;
  addImage: (id: string, src: ImageSource) => void;
  undo: () => void;
  redo: () => void;
  bump: () => void;
  setTitle: (t: string) => void;
  markSaved: (assetId: number, projectId: number | null, title: string) => void;
  reset: () => void;
  load: (doc: Doc, images: Record<string, ImageSource>, meta: { assetId: number; projectId: number | null; title: string }) => void;
}

const blankDoc = (): Doc => ({ width: 1280, height: 720, background: { ...DEFAULT_BACKGROUND }, layers: [] });

export const useThumb = create<ThumbState>((set, get) => ({
  doc: blankDoc(),
  images: {},
  selectedId: null,
  past: [],
  future: [],
  lastPush: 0,
  assetId: null,
  projectId: null,
  title: "",
  tick: 0,

  select: (selectedId) => set({ selectedId }),

  checkpoint: (force = false) => {
    const { doc, past, lastPush } = get();
    const now = Date.now();
    if (!force && now - lastPush < 600) return;
    set({ past: [...past, doc].slice(-MAX_HISTORY), future: [], lastPush: now });
  },

  addLayer: (l) => {
    get().checkpoint(true);
    set((s) => ({ doc: { ...s.doc, layers: [...s.doc.layers, l] }, selectedId: l.id }));
  },

  patchLayer: (id, patch) =>
    set((s) => ({
      doc: { ...s.doc, layers: s.doc.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)) },
    })),

  removeLayer: (id) => {
    get().checkpoint(true);
    set((s) => ({
      doc: { ...s.doc, layers: s.doc.layers.filter((l) => l.id !== id) },
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
  },

  moveLayer: (id, dir) => {
    const layers = [...get().doc.layers];
    const i = layers.findIndex((l) => l.id === id);
    const j = i + dir;
    const a = layers[i];
    const b = layers[j];
    if (a === undefined || b === undefined) return;
    get().checkpoint(true);
    layers[i] = b;
    layers[j] = a;
    set((s) => ({ doc: { ...s.doc, layers } }));
  },

  duplicateLayer: (id) => {
    const src = get().doc.layers.find((l) => l.id === id);
    if (!src) return;
    const copy = { ...src, id: Math.random().toString(36).slice(2, 10), name: `${src.name} copy`, x: src.x + 30, y: src.y + 30 };
    get().addLayer(copy);
  },

  setBackground: (background) => {
    get().checkpoint();
    set((s) => ({ doc: { ...s.doc, background } }));
  },

  setSize: ({ width, height }) => {
    get().checkpoint(true);
    set((s) => {
      // Keep layers at the same relative position when the canvas changes shape.
      const fx = width / s.doc.width;
      const fy = height / s.doc.height;
      const f = Math.min(fx, fy);
      return {
        doc: {
          ...s.doc,
          width,
          height,
          layers: s.doc.layers.map((l) => ({ ...l, x: l.x * fx, y: l.y * fy, scale: l.scale * f })),
        },
      };
    });
  },

  addImage: (id, src) => set((s) => ({ images: { ...s.images, [id]: src } })),

  undo: () => {
    const { past, doc, future } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future], lastPush: 0 });
  },

  redo: () => {
    const { future, doc, past } = get();
    const next = future[0];
    if (!next) return;
    set({ doc: next, future: future.slice(1), past: [...past, doc], lastPush: 0 });
  },

  bump: () => set((s) => ({ tick: s.tick + 1 })),
  setTitle: (title) => set({ title }),
  markSaved: (assetId, projectId, title) => set({ assetId, projectId, title }),
  reset: () =>
    set({ doc: blankDoc(), images: {}, selectedId: null, past: [], future: [], assetId: null, projectId: null, title: "", lastPush: 0 }),
  load: (doc, images, meta) =>
    set({ doc, images, selectedId: null, past: [], future: [], lastPush: 0, ...meta }),
}));
