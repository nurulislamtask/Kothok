import { api, bytesToBase64, type Asset } from "../../lib/api";
import { useThumb } from "../../stores/thumbnail";
import { newId, newImageLayer, type Doc, type ImageLayer } from "./model";
import { renderToBlob, type ImageSource } from "./render";

export function toDataUrl(mime: string, b64: string): string {
  return `data:${mime};base64,${b64}`;
}

function measure(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("unsupported image"));
    img.src = dataUrl;
  });
}

/** Register an image with the editor and add it as a new layer. */
export async function addImageFromData(mime: string, b64: string, name: string): Promise<void> {
  const dataUrl = toDataUrl(mime, b64);
  const { w, h } = await measure(dataUrl);
  const id = newId();
  const st = useThumb.getState();
  st.addImage(id, { dataUrl, mime, w, h });
  st.addLayer(newImageLayer(st.doc, id, w, h, name));
}

function extFor(mime: string): string {
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "png";
}

interface SavedMeta {
  doc: Doc;
  /** imageId -> media file name */
  imageMap: Record<string, string>;
  media: string[];
}

/** Persist the design (flattened PNG + editable layers) and return the asset. */
export async function saveDesign(projectId: number, title: string): Promise<Asset> {
  const st = useThumb.getState();
  const used = [...new Set(st.doc.layers.filter((l): l is ImageLayer => l.kind === "image").map((l) => l.imageId))];
  const imageMap: Record<string, string> = {};
  for (const id of used) {
    const src = st.images[id];
    if (!src) continue;
    const b64 = src.dataUrl.split(",")[1] ?? "";
    imageMap[id] = await api.saveMedia(extFor(src.mime), b64);
  }
  const blob = await renderToBlob(st.doc, st.images, "image/png", 1);
  const flat = await api.saveMedia("png", bytesToBase64(new Uint8Array(await blob.arrayBuffer())));
  const meta: SavedMeta = { doc: st.doc, imageMap, media: Object.values(imageMap) };
  const asset = await api.saveAsset({
    id: st.assetId ?? undefined,
    projectId,
    kind: "thumbnail",
    title: title || null,
    filePath: flat,
    body: null,
    lang: null,
    metaJson: JSON.stringify(meta),
  });
  st.markSaved(asset.id, asset.projectId, title);
  return asset;
}

/** Load a saved design back into the editor. */
export async function loadDesign(asset: Asset): Promise<void> {
  if (!asset.metaJson) throw new Error("design data missing");
  const meta = JSON.parse(asset.metaJson) as SavedMeta;
  const images: Record<string, ImageSource> = {};
  for (const [id, path] of Object.entries(meta.imageMap)) {
    const file = await api.readMedia(path);
    const layer = meta.doc.layers.find((l): l is ImageLayer => l.kind === "image" && l.imageId === id);
    if (!layer) continue;
    images[id] = { dataUrl: toDataUrl(file.mime, file.dataB64), mime: file.mime, w: layer.w, h: layer.h };
  }
  useThumb.getState().load(meta.doc, images, {
    assetId: asset.id,
    projectId: asset.projectId,
    title: asset.title ?? "",
  });
}
