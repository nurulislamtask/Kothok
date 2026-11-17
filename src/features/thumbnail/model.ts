export interface BaseLayer {
  id: string;
  name: string;
  /** Centre of the layer in document pixels. */
  x: number;
  y: number;
  scale: number;
  /** Degrees. */
  rotation: number;
  opacity: number;
  visible: boolean;
}

export interface ImageLayer extends BaseLayer {
  kind: "image";
  imageId: string;
  /** Natural size of the source image. */
  w: number;
  h: number;
  /** Crop, in percent of the source size removed from each side. */
  cropL: number;
  cropT: number;
  cropR: number;
  cropB: number;
}

export interface TextLayer extends BaseLayer {
  kind: "text";
  text: string;
  font: string;
  size: number;
  weight: number;
  italic: boolean;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  shadow: boolean;
  align: "left" | "center" | "right";
  /** Wrap width in px before scaling; 0 disables wrapping. */
  wrapWidth: number;
  lineHeight: number;
}

export type Layer = ImageLayer | TextLayer;

export interface Background {
  kind: "solid" | "gradient";
  c1: string;
  c2: string;
  angle: number;
}

export interface Doc {
  width: number;
  height: number;
  background: Background;
  layers: Layer[];
}

export interface SizePreset {
  id: string;
  width: number;
  height: number;
}

export const SIZE_PRESETS: readonly SizePreset[] = [
  { id: "youtube", width: 1280, height: 720 },
  { id: "shorts", width: 1080, height: 1920 },
  { id: "facebook", width: 1200, height: 630 },
  { id: "instagramSquare", width: 1080, height: 1080 },
  { id: "instagramPortrait", width: 1080, height: 1350 },
];

export const FONTS: readonly string[] = [
  "Inter Variable",
  "Noto Sans Bengali",
  "Nirmala UI",
  "Impact",
  "Arial Black",
  "Arial",
  "Segoe UI",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Georgia",
  "Times New Roman",
  "Comic Sans MS",
];

export const GRADIENTS: ReadonlyArray<{ c1: string; c2: string }> = [
  { c1: "#7c5cf6", c2: "#1e1b4b" },
  { c1: "#f97316", c2: "#be123c" },
  { c1: "#06b6d4", c2: "#1d4ed8" },
  { c1: "#22c55e", c2: "#065f46" },
  { c1: "#facc15", c2: "#dc2626" },
  { c1: "#111827", c2: "#374151" },
];

export const DEFAULT_BACKGROUND: Background = { kind: "gradient", c1: "#7c5cf6", c2: "#1e1b4b", angle: 135 };

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function newTextLayer(doc: Pick<Doc, "width" | "height">, text: string): TextLayer {
  return {
    id: newId(),
    name: text.slice(0, 20) || "Text",
    kind: "text",
    x: doc.width / 2,
    y: doc.height / 2,
    scale: 1,
    rotation: 0,
    opacity: 1,
    visible: true,
    text,
    font: "Noto Sans Bengali",
    size: Math.round(doc.height / 6),
    weight: 700,
    italic: false,
    color: "#ffffff",
    strokeColor: "#000000",
    strokeWidth: Math.round(doc.height / 120),
    shadow: true,
    align: "center",
    wrapWidth: Math.round(doc.width * 0.8),
    lineHeight: 1.2,
  };
}

export function newImageLayer(
  doc: Pick<Doc, "width" | "height">,
  imageId: string,
  w: number,
  h: number,
  name: string,
): ImageLayer {
  // Fit inside the canvas (contain) by default.
  const scale = Math.min(doc.width / w, doc.height / h);
  return {
    id: newId(),
    name,
    kind: "image",
    x: doc.width / 2,
    y: doc.height / 2,
    scale,
    rotation: 0,
    opacity: 1,
    visible: true,
    imageId,
    w,
    h,
    cropL: 0,
    cropT: 0,
    cropR: 0,
    cropB: 0,
  };
}
