import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Wand2 } from "lucide-react";
import { api, isReady } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { defaultProvider, useProviders } from "../../stores/providers";
import { useThumb } from "../../stores/thumbnail";
import { toast } from "../../stores/toast";
import { useUi } from "../../stores/ui";
import ModelPicker from "../../components/ModelPicker";
import { Button, Field, Input, Modal, Select, Textarea } from "../../components/ui/controls";
import { addImageFromData } from "./imageIo";

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
  let best = "1:1";
  let bestD = Infinity;
  for (const [name, v] of ASPECTS) {
    const d = Math.abs(v - r);
    if (d < bestD) {
      best = name;
      bestD = d;
    }
  }
  return best;
}

const OPENAI_SIZES = ["", "1024x1024", "1536x1024", "1024x1536", "1792x1024", "1024x1792"];

export default function AiImageModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const setRoute = useUi((s) => s.setRoute);
  const providers = useProviders((s) => s.providers);
  const defaults = useProviders((s) => s.defaults);
  const doc = useThumb((s) => s.doc);

  const ready = useMemo(() => providers.filter((p) => p.category === "image" && isReady(p)), [providers]);
  const [providerId, setProviderId] = useState("");
  const provider = ready.find((p) => p.id === providerId) ?? defaultProvider({ providers, defaults }, "image") ?? ready[0];

  const [topic, setTopic] = useState("");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [size, setSize] = useState("");
  const [busy, setBusy] = useState<"suggest" | "generate" | null>(null);

  const suggest = async () => {
    if (!topic.trim()) {
      toast.error(t("thumb.needTopic"));
      return;
    }
    setBusy("suggest");
    try {
      const out = await api.generate({
        system:
          "You write prompts for text-to-image models. Reply with one detailed English prompt only (max 80 words): subject, composition, lighting, colours and style. The image must contain no text or lettering.",
        prompt: `Write an image prompt for a ${doc.width}x${doc.height} thumbnail about: ${topic.trim()}`,
      });
      setPrompt(out.text.trim());
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    if (!prompt.trim()) {
      toast.error(t("thumb.needPrompt"));
      return;
    }
    setBusy("generate");
    try {
      const out = await api.generateImage({
        providerId: provider?.id,
        model: model.trim() || undefined,
        prompt: prompt.trim(),
        size: provider?.adapter === "openai_images" && size ? size : undefined,
        aspect: provider?.adapter === "gemini_image" ? nearestAspect(doc.width, doc.height) : undefined,
      });
      await addImageFromData(out.mime, out.dataB64, t("thumb.aiImage"));
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
      title={t("thumb.aiTitle")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={busy !== null || !provider} onClick={() => void generate()}>
            <Sparkles className="size-4" aria-hidden />
            {busy === "generate" ? t("content.generating") : t("thumb.generate")}
          </Button>
        </>
      }
    >
      {ready.length === 0 ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <div className="font-medium">{t("thumb.noImageProvider")}</div>
          <p className="mt-1 text-xs text-muted-foreground">{t("thumb.noImageProviderBody")}</p>
          <Button
            size="sm"
            variant="primary"
            className="mt-3"
            onClick={() => {
              onClose();
              setRoute("apiManager");
            }}
          >
            {t("content.goApi")}
          </Button>
        </div>
      ) : (
        <>
          <Field label={t("thumb.topicLabel")}>
            <div className="flex gap-2">
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t("thumb.topicPlaceholder")} />
              <Button disabled={busy !== null} onClick={() => void suggest()}>
                <Wand2 className="size-4" aria-hidden />
                {busy === "suggest" ? t("content.generating") : t("thumb.suggest")}
              </Button>
            </div>
          </Field>
          <Field label={t("thumb.prompt")} hint={t("thumb.promptHint")}>
            <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("content.provider")}>
              <Select value={provider?.id ?? ""} onChange={(e) => { setProviderId(e.target.value); setModel(""); }}>
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
          {provider?.adapter === "openai_images" && (
            <Field label={t("thumb.imageSize")}>
              <Select value={size} onChange={(e) => setSize(e.target.value)}>
                {OPENAI_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s || t("thumb.sizeAuto")}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {provider?.costClass === "paid" && <p className="text-xs text-amber-500">{t("thumb.paidNote")}</p>}
        </>
      )}
    </Modal>
  );
}
