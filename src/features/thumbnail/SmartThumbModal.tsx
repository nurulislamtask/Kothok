import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, ImagePlus, Sparkles, Wand2, X } from "lucide-react";
import { api, bytesToBase64, isReady } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { useContent } from "../../stores/content";
import { defaultProvider, useProviders } from "../../stores/providers";
import { useThumb } from "../../stores/thumbnail";
import { toast } from "../../stores/toast";
import { useVoice } from "../../stores/voice";
import ModelPicker from "../../components/ModelPicker";
import NeedProvider from "../../components/NeedProvider";
import { Button, Field, Input, Modal, Select, Textarea } from "../../components/ui/controls";
import { addImageFromData } from "./imageIo";
import { newTextLayer } from "./model";
import { renderToBlob } from "./render";

const ASPECTS: ReadonlyArray<[string, number]> = [
  ["1:1", 1],
  ["4:5", 0.8],
  ["3:4", 0.75],
  ["2:3", 2 / 3],
  ["9:16", 9 / 16],
  ["3:2", 1.5],
  ["4:3", 4 / 3],
  ["16:9", 16 / 9],
];

function nearestAspect(w: number, h: number): string {
  const r = w / h;
  return ASPECTS.reduce((best, a) => (Math.abs(a[1] - r) < Math.abs(best[1] - r) ? a : best))[0];
}

interface Ref {
  mime: string;
  dataB64: string;
  name: string;
}

/** Pull the first JSON object out of a model reply, tolerating code fences and chatter. */
export function parsePlan(text: string): { headline: string; prompt: string } | null {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const v = JSON.parse(text.slice(a, b + 1)) as { headline?: unknown; imagePrompt?: unknown };
    const headline = typeof v.headline === "string" ? v.headline.trim() : "";
    const prompt = typeof v.imagePrompt === "string" ? v.imagePrompt.trim() : "";
    return prompt ? { headline, prompt } : null;
  } catch {
    return null;
  }
}

/**
 * Make a thumbnail from a script, optionally copying the design of a reference thumbnail while the
 * subject changes. The picture is generated without lettering and the headline is added as an
 * editable text layer, because image models draw Bengali text unreliably.
 */
export default function SmartThumbModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const providers = useProviders((s) => s.providers);
  const defaults = useProviders((s) => s.defaults);
  const doc = useThumb((s) => s.doc);
  const contentBody = useContent((s) => s.body);
  const voiceBlocks = useVoice((s) => s.blocks);

  const ready = useMemo(() => providers.filter((p) => p.category === "image" && isReady(p)), [providers]);
  const [providerId, setProviderId] = useState("");
  const provider = ready.find((p) => p.id === providerId) ?? defaultProvider({ providers, defaults }, "image") ?? ready[0];
  const geminiImage = provider?.adapter === "gemini_image";

  const [script, setScript] = useState("");
  const [lang, setLang] = useState<"bn" | "en">("bn");
  const [addText, setAddText] = useState(true);
  const [headline, setHeadline] = useState("");
  const [prompt, setPrompt] = useState("");
  const [ref, setRef] = useState<Ref | null>(null);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState<"plan" | "make" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const voiceText = voiceBlocks.map((b) => b.text.trim()).filter(Boolean).join("\n\n");

  const analyze = async () => {
    if (!script.trim()) {
      toast.error(t("thumb.smart.needScript"));
      return;
    }
    setBusy("plan");
    try {
      const out = await api.generate({
        system:
          `You design video thumbnails. Read the script and reply with JSON only, no other text: ` +
          `{"headline": "...", "imagePrompt": "..."}. "headline" is a short, curiosity-creating title of at most 6 words written in ${lang === "bn" ? "Bangla (Bengali script)" : "English"}. ` +
          `"imagePrompt" is one detailed English prompt (max 90 words) for a text-to-image model describing the most striking visual for this script: subject, emotion, composition, lighting, colours, style. ` +
          `The image must contain no text, letters or logos.`,
        prompt: `Script:\n${script.trim().slice(0, 6000)}`,
        temperature: 0.8,
      });
      const plan = parsePlan(out.text);
      if (!plan) {
        toast.error(t("thumb.smart.badPlan"));
        return;
      }
      setHeadline(plan.headline);
      setPrompt(plan.prompt);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) {
      toast.error(t("thumb.smart.badType"));
      return;
    }
    if (f.size > 8 * 1024 * 1024) {
      toast.error(t("thumb.smart.tooBig"));
      return;
    }
    void f.arrayBuffer().then((buf) => setRef({ mime: f.type, dataB64: bytesToBase64(new Uint8Array(buf)), name: f.name }));
  };

  const useCanvas = async () => {
    try {
      const st = useThumb.getState();
      const blob = await renderToBlob(st.doc, st.images, "image/png", 1);
      setRef({ mime: "image/png", dataB64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())), name: t("thumb.smart.currentCanvas") });
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const make = async () => {
    if (!prompt.trim()) {
      toast.error(t("thumb.smart.needPlan"));
      return;
    }
    setBusy("make");
    try {
      const full = ref
        ? `Recreate the attached reference thumbnail with exactly the same layout, composition, camera angle, colour palette, lighting, style and visual effects. Change only the subject and story so it matches this description: ${prompt.trim()} ` +
          `Remove all text, letters and logos from the picture; leave the areas where text was empty and clean.`
        : `${prompt.trim()} The picture must contain no text, letters or logos.`;
      const out = await api.generateImage({
        providerId: provider?.id,
        model: model.trim() || undefined,
        prompt: full,
        aspect: geminiImage ? nearestAspect(doc.width, doc.height) : undefined,
        size: provider?.adapter === "openai_images" ? "1536x1024" : undefined,
        references: ref ? [{ mime: ref.mime, dataB64: ref.dataB64 }] : undefined,
      });
      await addImageFromData(out.mime, out.dataB64, t("thumb.aiImage"));
      if (addText && headline.trim()) {
        const st = useThumb.getState();
        const layer = newTextLayer(st.doc, headline.trim());
        layer.y = Math.round(st.doc.height * 0.78);
        st.addLayer(layer);
      }
      toast.success(t("thumb.generated", { provider: out.providerName }));
      onClose();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title={t("thumb.smart.title")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={busy !== null || !provider || !prompt.trim() || (ref !== null && !geminiImage)} onClick={() => void make()}>
            <Sparkles className="size-4" aria-hidden />
            {busy === "make" ? t("content.generating") : t("thumb.smart.make")}
          </Button>
        </>
      }
    >
      {ready.length === 0 ? (
        <NeedProvider category="image" title={t("thumb.noImageProvider")} body={t("thumb.noImageProviderBody")} />
      ) : (
        <div className="space-y-4">
          <Field label={t("thumb.smart.script")} hint={t("thumb.smart.scriptHint")}>
            <Textarea rows={5} value={script} onChange={(e) => setScript(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!contentBody.trim()} onClick={() => setScript(contentBody)}>
              <FileText className="size-3.5" aria-hidden />
              {t("thumb.smart.fromContent")}
            </Button>
            <Button size="sm" disabled={!voiceText} onClick={() => setScript(voiceText)}>
              <FileText className="size-3.5" aria-hidden />
              {t("thumb.smart.fromVoice")}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("thumb.smart.headlineLang")}>
              <Select value={lang} onChange={(e) => setLang(e.target.value === "en" ? "en" : "bn")}>
                <option value="bn">বাংলা</option>
                <option value="en">English</option>
              </Select>
            </Field>
            <div className="flex items-end">
              <Button disabled={busy !== null} onClick={() => void analyze()}>
                <Wand2 className="size-4" aria-hidden />
                {busy === "plan" ? t("content.generating") : t("thumb.smart.analyze")}
              </Button>
            </div>
          </div>

          <Field label={t("thumb.smart.headline")}>
            <Input value={headline} onChange={(e) => setHeadline(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={addText} onChange={(e) => setAddText(e.target.checked)} />
            {t("thumb.smart.addText")}
          </label>
          <Field label={t("thumb.prompt")} hint={t("thumb.smart.promptHint")}>
            <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </Field>

          <div className="rounded-lg border p-3">
            <div className="text-sm font-medium">{t("thumb.smart.refTitle")}</div>
            <p className="mt-1 text-xs text-muted-foreground">{t("thumb.smart.refHint")}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
              <Button size="sm" onClick={() => fileRef.current?.click()}>
                <ImagePlus className="size-3.5" aria-hidden />
                {t("thumb.smart.upload")}
              </Button>
              <Button size="sm" disabled={doc.layers.length === 0} onClick={() => void useCanvas()}>
                {t("thumb.smart.useCanvas")}
              </Button>
              {ref && (
                <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
                  {ref.name}
                  <button type="button" onClick={() => setRef(null)} aria-label={t("common.delete")}>
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              )}
            </div>
            {ref && !geminiImage && <p className="mt-2 text-xs text-amber-500">{t("thumb.smart.geminiOnly")}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("content.provider")}>
              <Select
                value={provider?.id ?? ""}
                onChange={(e) => {
                  setProviderId(e.target.value);
                  setModel("");
                }}
              >
                {ready.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("content.model")}>
              <ModelPicker provider={provider} value={model} onChange={setModel} />
            </Field>
          </div>
          {provider?.costClass === "paid" && <p className="text-xs text-amber-500">{t("thumb.paidNote")}</p>}
        </div>
      )}
    </Modal>
  );
}
