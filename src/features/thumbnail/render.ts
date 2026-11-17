import type { Doc, ImageLayer, Layer, TextLayer } from "./model";

export interface ImageSource {
  dataUrl: string;
  mime: string;
  w: number;
  h: number;
}

const decoded = new Map<string, HTMLImageElement>();

/** Returns the decoded image if ready, otherwise starts decoding and calls onReady when done. */
export function getImage(id: string, src: ImageSource | undefined, onReady: () => void): HTMLImageElement | null {
  if (!src) return null;
  const hit = decoded.get(id);
  if (hit) return hit.complete && hit.naturalWidth > 0 ? hit : null;
  const img = new Image();
  decoded.set(id, img);
  img.onload = onReady;
  img.onerror = () => decoded.delete(id);
  img.src = src.dataUrl;
  return null;
}

export function fontString(l: TextLayer): string {
  return `${l.italic ? "italic " : ""}${l.weight} ${l.size}px "${l.font}", "Noto Sans Bengali", "Nirmala UI", sans-serif`;
}

export interface TextLayout {
  lines: string[];
  w: number;
  h: number;
}

export function layoutText(ctx: CanvasRenderingContext2D, l: TextLayer): TextLayout {
  ctx.font = fontString(l);
  const out: string[] = [];
  for (const raw of l.text.split(/\r?\n/)) {
    if (l.wrapWidth <= 0) {
      out.push(raw);
      continue;
    }
    let line = "";
    for (const word of raw.split(" ")) {
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > l.wrapWidth) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  const w = Math.max(1, ...out.map((s) => ctx.measureText(s).width));
  const h = Math.max(1, out.length * l.size * l.lineHeight);
  return { lines: out, w, h };
}

/** Unscaled size of a layer (before `scale`). */
export function layerSize(ctx: CanvasRenderingContext2D, l: Layer): { w: number; h: number } {
  if (l.kind === "image") {
    return {
      w: Math.max(1, l.w * (1 - (l.cropL + l.cropR) / 100)),
      h: Math.max(1, l.h * (1 - (l.cropT + l.cropB) / 100)),
    };
  }
  const t = layoutText(ctx, l);
  return { w: t.w, h: t.h };
}

function drawImageLayer(ctx: CanvasRenderingContext2D, l: ImageLayer, img: HTMLImageElement): void {
  const sx = (l.cropL / 100) * l.w;
  const sy = (l.cropT / 100) * l.h;
  const sw = Math.max(1, l.w * (1 - (l.cropL + l.cropR) / 100));
  const sh = Math.max(1, l.h * (1 - (l.cropT + l.cropB) / 100));
  // Source rect is in natural pixels of the decoded image, which may differ from l.w/l.h.
  const kx = img.naturalWidth / l.w;
  const ky = img.naturalHeight / l.h;
  ctx.drawImage(img, sx * kx, sy * ky, sw * kx, sh * ky, -sw / 2, -sh / 2, sw, sh);
}

function drawTextLayer(ctx: CanvasRenderingContext2D, l: TextLayer): void {
  const t = layoutText(ctx, l);
  ctx.font = fontString(l);
  ctx.textBaseline = "middle";
  ctx.textAlign = l.align;
  ctx.lineJoin = "round";
  const lh = l.size * l.lineHeight;
  const anchorX = l.align === "left" ? -t.w / 2 : l.align === "right" ? t.w / 2 : 0;
  t.lines.forEach((line, i) => {
    const y = -t.h / 2 + lh * i + lh / 2;
    if (l.shadow) {
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = l.size / 8;
      ctx.shadowOffsetY = l.size / 24;
    }
    if (l.strokeWidth > 0) {
      ctx.lineWidth = l.strokeWidth * 2;
      ctx.strokeStyle = l.strokeColor;
      ctx.strokeText(line, anchorX, y);
    }
    ctx.shadowColor = "transparent";
    ctx.fillStyle = l.color;
    if (l.shadow && l.strokeWidth <= 0) {
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = l.size / 8;
      ctx.shadowOffsetY = l.size / 24;
    }
    ctx.fillText(line, anchorX, y);
    ctx.shadowColor = "transparent";
  });
}

export interface RenderOptions {
  selectedId: string | null;
  overlay: boolean;
  /** Display pixels per document pixel, used to keep handles a constant on-screen size. */
  zoom: number;
}

export function render(
  ctx: CanvasRenderingContext2D,
  doc: Doc,
  images: Record<string, ImageSource>,
  onImageReady: () => void,
  opts: RenderOptions,
): void {
  const { width: W, height: H, background: bg } = doc;
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  if (bg.kind === "solid") {
    ctx.fillStyle = bg.c1;
  } else {
    const a = (bg.angle * Math.PI) / 180;
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.abs(Math.cos(a)) * W + Math.abs(Math.sin(a)) * H;
    const dx = (Math.cos(a) * r) / 2;
    const dy = (Math.sin(a) * r) / 2;
    const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    g.addColorStop(0, bg.c1);
    g.addColorStop(1, bg.c2);
    ctx.fillStyle = g;
  }
  ctx.fillRect(0, 0, W, H);

  for (const l of doc.layers) {
    if (!l.visible) continue;
    ctx.save();
    ctx.globalAlpha = l.opacity;
    ctx.translate(l.x, l.y);
    ctx.rotate((l.rotation * Math.PI) / 180);
    ctx.scale(l.scale, l.scale);
    if (l.kind === "image") {
      const img = getImage(l.imageId, images[l.imageId], onImageReady);
      if (img) drawImageLayer(ctx, l, img);
    } else {
      drawTextLayer(ctx, l);
    }
    ctx.restore();
  }

  if (opts.overlay && opts.selectedId) {
    const sel = doc.layers.find((l) => l.id === opts.selectedId);
    if (sel) drawSelection(ctx, sel, opts.zoom);
  }
  ctx.restore();
}

export const HANDLE_PX = 12;

export function selectionBox(ctx: CanvasRenderingContext2D, l: Layer): { hw: number; hh: number } {
  const s = layerSize(ctx, l);
  return { hw: (s.w * l.scale) / 2, hh: (s.h * l.scale) / 2 };
}

function drawSelection(ctx: CanvasRenderingContext2D, l: Layer, zoom: number): void {
  const { hw, hh } = selectionBox(ctx, l);
  ctx.save();
  ctx.translate(l.x, l.y);
  ctx.rotate((l.rotation * Math.PI) / 180);
  ctx.lineWidth = 2 / zoom;
  ctx.strokeStyle = "#7c5cf6";
  ctx.setLineDash([6 / zoom, 4 / zoom]);
  ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
  ctx.setLineDash([]);
  const hs = HANDLE_PX / zoom;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#7c5cf6";
  ctx.fillRect(hw - hs / 2, hh - hs / 2, hs, hs);
  ctx.strokeRect(hw - hs / 2, hh - hs / 2, hs, hs);
  ctx.restore();
}

/** Convert a document-space point into a layer's local (unscaled, unrotated) space. */
export function toLocal(l: Layer, px: number, py: number): { x: number; y: number } {
  const a = (-l.rotation * Math.PI) / 180;
  const dx = px - l.x;
  const dy = py - l.y;
  return {
    x: dx * Math.cos(a) - dy * Math.sin(a),
    y: dx * Math.sin(a) + dy * Math.cos(a),
  };
}

export function hitLayer(ctx: CanvasRenderingContext2D, l: Layer, px: number, py: number): boolean {
  if (!l.visible) return false;
  const { hw, hh } = selectionBox(ctx, l);
  const p = toLocal(l, px, py);
  return Math.abs(p.x) <= hw && Math.abs(p.y) <= hh;
}

export function hitHandle(ctx: CanvasRenderingContext2D, l: Layer, px: number, py: number, zoom: number): boolean {
  const { hw, hh } = selectionBox(ctx, l);
  const p = toLocal(l, px, py);
  const tol = (HANDLE_PX * 1.4) / zoom;
  return Math.abs(p.x - hw) <= tol && Math.abs(p.y - hh) <= tol;
}

export async function ensureFonts(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load('700 40px "Noto Sans Bengali"'),
      document.fonts.load('400 40px "Noto Sans Bengali"'),
      document.fonts.load('700 40px "Inter Variable"'),
    ]);
  } catch {
    // Fonts are a nicety; canvas falls back to system fonts.
  }
}

export async function renderToBlob(
  doc: Doc,
  images: Record<string, ImageSource>,
  type: "image/png" | "image/jpeg" | "image/webp",
  quality: number,
): Promise<Blob> {
  await ensureFonts();
  // Make sure every referenced image is decoded before drawing.
  await Promise.all(
    doc.layers
      .filter((l): l is ImageLayer => l.kind === "image")
      .map(
        (l) =>
          new Promise<void>((resolve) => {
            if (getImage(l.imageId, images[l.imageId], resolve)) resolve();
          }),
      ),
  );
  const canvas = document.createElement("canvas");
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  render(ctx, doc, images, () => undefined, { selectedId: null, overlay: false, zoom: 1 });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("export failed"))), type, quality);
  });
}
