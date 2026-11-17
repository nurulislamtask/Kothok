import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  Eye,
  EyeOff,
  FilePlus,
  ImagePlus,
  Redo2,
  Save,
  Sparkles,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { api, bytesToBase64 } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { safeName } from "../../lib/exporters";
import { cn } from "../../lib/utils";
import { useThumb } from "../../stores/thumbnail";
import { toast } from "../../stores/toast";
import SaveToProjectModal from "../../components/SaveToProjectModal";
import { Button, Field, Select, Textarea } from "../../components/ui/controls";
import AiImageModal from "./AiImageModal";
import { addImageFromData, saveDesign } from "./imageIo";
import { FONTS, GRADIENTS, SIZE_PRESETS, newTextLayer, type ImageLayer, type Layer, type TextLayer } from "./model";
import { ensureFonts, hitHandle, hitLayer, render, renderToBlob } from "./render";

function Num({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1"
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(n);
        }}
        className="h-7 w-16 rounded-md border bg-muted/40 px-1.5 text-end text-xs"
      />
    </label>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-10 cursor-pointer rounded border bg-transparent p-0.5"
      />
      <span className="text-muted-foreground">{value}</span>
    </label>
  );
}

interface Drag {
  mode: "move" | "scale";
  id: string;
  startX: number;
  startY: number;
  layerX: number;
  layerY: number;
  startScale: number;
  startDist: number;
  moved: boolean;
}

export default function ThumbnailPage() {
  const { t } = useTranslation();
  const doc = useThumb((s) => s.doc);
  const images = useThumb((s) => s.images);
  const selectedId = useThumb((s) => s.selectedId);
  const tick = useThumb((s) => s.tick);
  const canUndo = useThumb((s) => s.past.length > 0);
  const canRedo = useThumb((s) => s.future.length > 0);
  const title = useThumb((s) => s.title);
  const projectId = useThumb((s) => s.projectId);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [zoom, setZoom] = useState(0.5);
  const [aiOpen, setAiOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [customW, setCustomW] = useState(String(doc.width));
  const [customH, setCustomH] = useState(String(doc.height));

  const sel = useMemo(() => doc.layers.find((l) => l.id === selectedId) ?? null, [doc.layers, selectedId]);
  const bump = useThumb((s) => s.bump);

  useEffect(() => {
    void ensureFonts().then(bump);
  }, [bump]);

  useEffect(() => {
    setCustomW(String(doc.width));
    setCustomH(String(doc.height));
  }, [doc.width, doc.height]);

  // Fit the canvas into the available space.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const calc = () => {
      const pad = 48;
      const zx = (el.clientWidth - pad) / doc.width;
      const zy = (el.clientHeight - pad) / doc.height;
      setZoom(Math.max(0.05, Math.min(zx, zy, 1.5)));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc.width, doc.height]);

  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    render(ctx, doc, images, bump, { selectedId, overlay: true, zoom });
  }, [doc, images, selectedId, zoom, tick, bump]);

  // Keyboard: Delete removes the layer, Ctrl+Z / Ctrl+Y undo / redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const st = useThumb.getState();
      if ((e.key === "Delete" || e.key === "Backspace") && st.selectedId) {
        st.removeLayer(st.selectedId);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        st.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toDoc = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * doc.width) / rect.width,
      y: ((e.clientY - rect.top) * doc.height) / rect.height,
    };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = toDoc(e);
    const st = useThumb.getState();
    const cur = st.doc.layers.find((l) => l.id === st.selectedId);
    if (cur && hitHandle(ctx, cur, p.x, p.y, zoom)) {
      drag.current = {
        mode: "scale",
        id: cur.id,
        startX: p.x,
        startY: p.y,
        layerX: cur.x,
        layerY: cur.y,
        startScale: cur.scale,
        startDist: Math.max(1, Math.hypot(p.x - cur.x, p.y - cur.y)),
        moved: false,
      };
    } else {
      const hit = [...st.doc.layers].reverse().find((l) => hitLayer(ctx, l, p.x, p.y));
      if (!hit) {
        st.select(null);
        return;
      }
      st.select(hit.id);
      drag.current = {
        mode: "move",
        id: hit.id,
        startX: p.x,
        startY: p.y,
        layerX: hit.x,
        layerY: hit.y,
        startScale: hit.scale,
        startDist: 1,
        moved: false,
      };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = toDoc(e);
    const st = useThumb.getState();
    if (!d.moved) {
      st.checkpoint(true);
      d.moved = true;
    }
    if (d.mode === "move") {
      st.patchLayer(d.id, { x: d.layerX + (p.x - d.startX), y: d.layerY + (p.y - d.startY) });
    } else {
      const dist = Math.hypot(p.x - d.layerX, p.y - d.layerY);
      st.patchLayer(d.id, { scale: Math.min(20, Math.max(0.02, (d.startScale * dist) / d.startDist)) });
    }
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const patch = (p: Partial<Layer>) => {
    if (!sel) return;
    const st = useThumb.getState();
    st.checkpoint();
    st.patchLayer(sel.id, p);
  };

  const addText = () => useThumb.getState().addLayer(newTextLayer(doc, t("thumb.defaultText")));

  const upload = async () => {
    try {
      const f = await api.importFile("Images", ["png", "jpg", "jpeg", "webp", "gif"]);
      if (f) await addImageFromData(f.mime, f.dataB64, f.name);
    } catch (e) {
      toast.error(e instanceof Error ? t("thumb.badImage") : errorText(e));
    }
  };

  const doExport = async (fmt: "png" | "jpg" | "webp") => {
    setExportOpen(false);
    try {
      const mime = fmt === "png" ? "image/png" : fmt === "jpg" ? "image/jpeg" : "image/webp";
      const blob = await renderToBlob(doc, images, mime, 0.92);
      const b64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
      const path = await api.exportFile(`${safeName(title, "thumbnail")}.${fmt}`, fmt.toUpperCase(), [fmt], b64);
      if (path) toast.success(t("content.exported", { path }));
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const presetId = SIZE_PRESETS.find((p) => p.width === doc.width && p.height === doc.height)?.id ?? "custom";
  const bg = doc.background;
  const st = useThumb.getState;

  const fit = (mode: "cover" | "contain", l: ImageLayer) => {
    const cw = l.w * (1 - (l.cropL + l.cropR) / 100);
    const ch = l.h * (1 - (l.cropT + l.cropB) / 100);
    const f = mode === "cover" ? Math.max(doc.width / cw, doc.height / ch) : Math.min(doc.width / cw, doc.height / ch);
    patch({ scale: f, x: doc.width / 2, y: doc.height / 2, rotation: 0 });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <Select
          className="h-8 w-44 text-xs"
          value={presetId}
          aria-label={t("thumb.size")}
          onChange={(e) => {
            const p = SIZE_PRESETS.find((x) => x.id === e.target.value);
            if (p) st().setSize(p);
          }}
        >
          {SIZE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {t(`thumb.presets.${p.id}`)} · {p.width}×{p.height}
            </option>
          ))}
          <option value="custom" disabled>
            {t("thumb.custom")}
          </option>
        </Select>
        <div className="flex items-center gap-1 text-xs">
          <input
            value={customW}
            onChange={(e) => setCustomW(e.target.value)}
            aria-label={t("thumb.width")}
            className="h-8 w-16 rounded-lg border bg-muted/40 px-2 text-end"
          />
          ×
          <input
            value={customH}
            onChange={(e) => setCustomH(e.target.value)}
            aria-label={t("thumb.height")}
            className="h-8 w-16 rounded-lg border bg-muted/40 px-2 text-end"
          />
          <Button
            size="sm"
            onClick={() => {
              const w = Math.round(Number(customW));
              const h = Math.round(Number(customH));
              if (w >= 100 && w <= 4096 && h >= 100 && h <= 4096) st().setSize({ width: w, height: h });
              else toast.error(t("thumb.sizeRange"));
            }}
          >
            {t("thumb.apply")}
          </Button>
        </div>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button size="sm" onClick={addText}>
          <Type className="size-3.5" aria-hidden />
          {t("thumb.addText")}
        </Button>
        <Button size="sm" onClick={() => void upload()}>
          <ImagePlus className="size-3.5" aria-hidden />
          {t("thumb.uploadImage")}
        </Button>
        <Button size="sm" variant="primary" onClick={() => setAiOpen(true)}>
          <Sparkles className="size-3.5" aria-hidden />
          {t("thumb.aiImage")}
        </Button>

        <div className="ms-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" disabled={!canUndo} onClick={() => st().undo()} aria-label={t("common.undo")}>
            <Undo2 className="size-3.5" aria-hidden />
          </Button>
          <Button size="sm" variant="ghost" disabled={!canRedo} onClick={() => st().redo()} aria-label={t("common.redo")}>
            <Redo2 className="size-3.5" aria-hidden />
          </Button>
          <Button size="sm" onClick={() => setSaveOpen(true)}>
            <Save className="size-3.5" aria-hidden />
            {t("common.save")}
          </Button>
          <div className="relative">
            <Button size="sm" onClick={() => setExportOpen((o) => !o)}>
              <Download className="size-3.5" aria-hidden />
              {t("content.export")}
            </Button>
            {exportOpen && (
              <div className="absolute end-0 top-9 z-10 w-28 overflow-hidden rounded-lg border bg-card p-1 shadow-lg">
                {(["png", "jpg", "webp"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => void doExport(f)}
                    className="w-full rounded-md px-3 py-2 text-start text-sm uppercase hover:bg-muted"
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={() => st().reset()}>
            <FilePlus className="size-3.5" aria-hidden />
            {t("content.new")}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div ref={stageRef} className="grid min-w-0 flex-1 place-items-center overflow-auto bg-muted/30 p-6">
          <canvas
            ref={canvasRef}
            width={doc.width}
            height={doc.height}
            style={{ width: doc.width * zoom, height: doc.height * zoom }}
            className="touch-none rounded-sm shadow-xl"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>

        <aside className="w-80 shrink-0 space-y-5 overflow-y-auto border-s p-4">
          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("thumb.background")}</h3>
            <div className="flex rounded-lg border bg-muted/40 p-0.5 text-xs">
              {(["solid", "gradient"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => st().setBackground({ ...bg, kind: k })}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1.5",
                    bg.kind === k ? "bg-card font-medium shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {t(`thumb.${k}`)}
                </button>
              ))}
            </div>
            <ColorInput label={t("thumb.color1")} value={bg.c1} onChange={(c1) => st().setBackground({ ...bg, c1 })} />
            {bg.kind === "gradient" && (
              <>
                <ColorInput label={t("thumb.color2")} value={bg.c2} onChange={(c2) => st().setBackground({ ...bg, c2 })} />
                <Num label={t("thumb.angle")} value={bg.angle} min={0} max={360} onChange={(angle) => st().setBackground({ ...bg, angle })} />
                <div className="flex gap-1.5">
                  {GRADIENTS.map((g) => (
                    <button
                      key={g.c1 + g.c2}
                      type="button"
                      aria-label={`${g.c1} → ${g.c2}`}
                      onClick={() => st().setBackground({ ...bg, kind: "gradient", c1: g.c1, c2: g.c2 })}
                      className="size-7 rounded-md border"
                      style={{ background: `linear-gradient(135deg, ${g.c1}, ${g.c2})` }}
                    />
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("thumb.layers")}</h3>
            {doc.layers.length === 0 && <p className="text-xs text-muted-foreground">{t("thumb.noLayers")}</p>}
            <ul className="space-y-1">
              {[...doc.layers].reverse().map((l) => (
                <li
                  key={l.id}
                  className={cn(
                    "flex items-center gap-1 rounded-lg border px-2 py-1.5 text-sm",
                    l.id === selectedId ? "border-primary/60 bg-muted" : "bg-card",
                  )}
                >
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => st().patchLayer(l.id, { visible: !l.visible })}
                    aria-label={l.visible ? t("thumb.hide") : t("thumb.show")}
                  >
                    {l.visible ? <Eye className="size-3.5" aria-hidden /> : <EyeOff className="size-3.5" aria-hidden />}
                  </button>
                  <button type="button" className="min-w-0 flex-1 truncate text-start" onClick={() => st().select(l.id)}>
                    {l.name}
                  </button>
                  <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => st().moveLayer(l.id, 1)} aria-label={t("api.moveUp")}>
                    <ArrowUp className="size-3.5" aria-hidden />
                  </button>
                  <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => st().moveLayer(l.id, -1)} aria-label={t("api.moveDown")}>
                    <ArrowDown className="size-3.5" aria-hidden />
                  </button>
                  <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => st().duplicateLayer(l.id)} aria-label={t("thumb.duplicate")}>
                    <Copy className="size-3.5" aria-hidden />
                  </button>
                  <button type="button" className="text-muted-foreground hover:text-red-500" onClick={() => st().removeLayer(l.id)} aria-label={t("common.delete")}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {sel && (
            <section className="space-y-2.5">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("thumb.properties")}</h3>
              <Num label={t("thumb.posX")} value={sel.x} min={-doc.width} max={doc.width * 2} onChange={(x) => patch({ x })} />
              <Num label={t("thumb.posY")} value={sel.y} min={-doc.height} max={doc.height * 2} onChange={(y) => patch({ y })} />
              <Num label={t("thumb.scale")} value={sel.scale} min={0.02} max={10} step={0.01} onChange={(scale) => patch({ scale })} />
              <Num label={t("thumb.rotation")} value={sel.rotation} min={-180} max={180} onChange={(rotation) => patch({ rotation })} />
              <Num label={t("thumb.opacity")} value={sel.opacity} min={0} max={1} step={0.05} onChange={(opacity) => patch({ opacity })} />

              {sel.kind === "image" && (
                <>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => fit("cover", sel)}>
                      {t("thumb.fitCover")}
                    </Button>
                    <Button size="sm" onClick={() => fit("contain", sel)}>
                      {t("thumb.fitContain")}
                    </Button>
                  </div>
                  <div className="text-xs font-medium text-muted-foreground">{t("thumb.crop")}</div>
                  <Num label={t("thumb.cropL")} value={sel.cropL} min={0} max={90} onChange={(v) => patch({ cropL: Math.min(v, 90 - sel.cropR) })} />
                  <Num label={t("thumb.cropR")} value={sel.cropR} min={0} max={90} onChange={(v) => patch({ cropR: Math.min(v, 90 - sel.cropL) })} />
                  <Num label={t("thumb.cropT")} value={sel.cropT} min={0} max={90} onChange={(v) => patch({ cropT: Math.min(v, 90 - sel.cropB) })} />
                  <Num label={t("thumb.cropB")} value={sel.cropB} min={0} max={90} onChange={(v) => patch({ cropB: Math.min(v, 90 - sel.cropT) })} />
                </>
              )}

              {sel.kind === "text" && <TextProps l={sel} patch={patch} />}
            </section>
          )}
        </aside>
      </div>

      {aiOpen && <AiImageModal onClose={() => setAiOpen(false)} />}
      {saveOpen && (
        <SaveToProjectModal
          initialTitle={title}
          initialProjectId={projectId}
          onClose={() => setSaveOpen(false)}
          onSave={async ({ projectId: pid, title: ttl }) => {
            await saveDesign(pid, ttl);
          }}
        />
      )}
    </div>
  );
}

function TextProps({ l, patch }: { l: TextLayer; patch: (p: Partial<Layer>) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <Field label={t("thumb.text")}>
        <Textarea rows={3} value={l.text} onChange={(e) => patch({ text: e.target.value, name: e.target.value.slice(0, 20) || "Text" })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("thumb.font")}>
          <Select value={l.font} onChange={(e) => patch({ font: e.target.value })}>
            {FONTS.map((f) => (
              <option key={f} value={f}>
                {f.replace(" Variable", "")}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("thumb.weight")}>
          <Select value={String(l.weight)} onChange={(e) => patch({ weight: Number(e.target.value) })}>
            {[400, 600, 700, 800, 900].map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Num label={t("thumb.fontSize")} value={l.size} min={8} max={600} onChange={(size) => patch({ size })} />
      <Num label={t("thumb.wrapWidth")} value={l.wrapWidth} min={0} max={4096} onChange={(wrapWidth) => patch({ wrapWidth })} />
      <ColorInput label={t("thumb.textColor")} value={l.color} onChange={(color) => patch({ color })} />
      <ColorInput label={t("thumb.strokeColor")} value={l.strokeColor} onChange={(strokeColor) => patch({ strokeColor })} />
      <Num label={t("thumb.strokeWidth")} value={l.strokeWidth} min={0} max={80} onChange={(strokeWidth) => patch({ strokeWidth })} />
      <div className="flex items-center gap-4 text-xs">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={l.shadow} onChange={(e) => patch({ shadow: e.target.checked })} />
          {t("thumb.shadow")}
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={l.italic} onChange={(e) => patch({ italic: e.target.checked })} />
          {t("thumb.italic")}
        </label>
        <Select
          className="h-7 w-24 text-xs"
          value={l.align}
          aria-label={t("thumb.align")}
          onChange={(e) => patch({ align: e.target.value as TextLayer["align"] })}
        >
          <option value="left">{t("thumb.alignLeft")}</option>
          <option value="center">{t("thumb.alignCenter")}</option>
          <option value="right">{t("thumb.alignRight")}</option>
        </Select>
      </div>
    </>
  );
}
