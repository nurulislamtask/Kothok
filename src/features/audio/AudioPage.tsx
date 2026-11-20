import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Captions, Copy, FileAudio, FolderPlus, Languages } from "lucide-react";
import { api, isReady, savedModel, type TranscribeOutput } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { exportPlain } from "../../lib/exporters";
import { defaultProvider, useProviders } from "../../stores/providers";
import { useSubs } from "../../stores/subtitles";
import { toast } from "../../stores/toast";
import { useUi } from "../../stores/ui";
import ModelPicker from "../../components/ModelPicker";
import { Button, Field, Select, Textarea } from "../../components/ui/controls";
import SaveToProjectModal from "../../components/SaveToProjectModal";
import { audioUrl } from "../voice/audioUrl";
import { formatSrt, type Segment } from "../subtitles/srt";

const LANGS: ReadonlyArray<[string, string]> = [
  ["", "auto"],
  ["bn", "বাংলা"],
  ["en", "English"],
  ["hi", "हिन्दी"],
  ["ur", "اردو"],
  ["ar", "العربية"],
];

/** Plain text with "Speaker N:" lines when the service separated speakers. */
export function withSpeakers(out: TranscribeOutput): string {
  if (!out.segments.some((s) => s.speaker)) return out.text;
  const names = new Map<string, number>();
  const lines: string[] = [];
  let last = "";
  for (const s of out.segments) {
    const k = s.speaker ?? "";
    if (!names.has(k)) names.set(k, names.size + 1);
    if (k !== last) {
      lines.push(`${k ? `Speaker ${names.get(k)}: ` : ""}${s.text}`);
      last = k;
    } else {
      lines[lines.length - 1] += ` ${s.text}`;
    }
  }
  return lines.join("\n\n");
}

export function toSegments(out: TranscribeOutput): Segment[] {
  return out.segments.map((s) => ({ start: s.startMs, end: s.endMs, text: s.text }));
}

export default function AudioPage() {
  const { t } = useTranslation();
  const setRoute = useUi((s) => s.setRoute);
  const providers = useProviders((s) => s.providers);
  const defaults = useProviders((s) => s.defaults);
  const ready = useMemo(() => providers.filter((p) => p.category === "stt" && isReady(p)), [providers]);
  const [providerId, setProviderId] = useState("");
  const provider = ready.find((p) => p.id === providerId) ?? defaultProvider({ providers, defaults }, "stt") ?? ready[0];

  const [file, setFile] = useState<{ media: string; label: string; url: string; big: boolean } | null>(null);
  const [model, setModel] = useState("");
  const [diarize, setDiarize] = useState(true);
  const modelName = model || (provider ? savedModel(provider) : "");
  const canDiarize = provider?.adapter === "gemini_stt" && modelName.includes("transcribe") && !modelName.includes("live");
  const [lang, setLang] = useState("bn");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TranscribeOutput | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const url = file?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [file?.url]);

  const pick = async () => {
    try {
      const f = await api.importAudio();
      if (!f) return;
      // Long recordings are not loaded into the player (it would need the whole file in memory).
      const url = f.size <= 40 * 1024 * 1024 ? await audioUrl(f.file) : "";
      if (file) void api.discardMedia(file.media).catch(() => undefined);
      setFile({ media: f.file, label: f.label, url, big: f.size > 25 * 1024 * 1024 });
      setResult(null);
      setText("");
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  // Drop an unsaved picked file when leaving the page.
  useEffect(() => {
    const media = file?.media;
    return () => {
      if (media) void api.discardMedia(media).catch(() => undefined);
    };
  }, [file?.media]);

  const run = async () => {
    if (!file || !provider) return;
    setBusy(true);
    try {
      const out = await api.transcribe({ providerId: provider.id, model: model.trim() || undefined, lang: lang || undefined, file: file.media, diarize: diarize && canDiarize });
      setResult(out);
      setText(withSpeakers(out));
      if (!out.hasTiming) toast.info(t("audio.noTiming"));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const baseName = file?.label.replace(/\.[^.]+$/, "") ?? "transcript";

  if (ready.length === 0) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-xl border border-amber-500/40 bg-amber-500/10 p-6 text-sm">
        <div className="font-medium">{t("audio.noProvider")}</div>
        <p className="mt-1 text-xs text-muted-foreground">{t("audio.noProviderBody")}</p>
        <Button className="mt-4" variant="primary" size="sm" onClick={() => setRoute("apiManager")}>
          {t("content.goApi")}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto h-full max-w-3xl space-y-5 overflow-y-auto p-6">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center gap-3">
          <Button onClick={() => void pick()}>
            <FileAudio className="size-4" aria-hidden />
            {t("audio.pick")}
          </Button>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{file?.label ?? t("audio.none")}</span>
        </div>
        {file && file.url && <audio controls src={file.url} className="mt-3 w-full" />}
        {file?.big && <p className="mt-2 text-xs text-amber-500">{t("audio.bigFile")}</p>}
        <p className="mt-3 text-xs text-muted-foreground">{t("audio.limits")}</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
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
        <Field label={t("voice.language")}>
          <Select value={lang} onChange={(e) => setLang(e.target.value)}>
            {LANGS.map(([code, label]) => (
              <option key={code} value={code}>
                {code === "" ? t("audio.auto") : label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {provider?.costClass === "paid" && <p className="text-xs text-amber-500">{t("audio.paidNote")}</p>}
      {canDiarize ? (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={diarize} onChange={(e) => setDiarize(e.target.checked)} />
          <span>
            {t("audio.diarize")}
            <span className="block text-xs text-muted-foreground">{t("audio.diarizeHint")}</span>
          </span>
        </label>
      ) : (
        <p className="text-xs text-muted-foreground">{t("audio.noSpeakers")}</p>
      )}

      <Button variant="primary" disabled={!file || busy} onClick={() => void run()}>
        <Languages className="size-4" aria-hidden />
        {busy ? t("audio.transcribing") : t("audio.transcribe")}
      </Button>

      {result && (
        <div className="space-y-3">
          <Field label={t("audio.result")} hint={result.language ? t("audio.detected", { lang: result.language }) : undefined}>
            <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() =>
                navigator.clipboard
                  .writeText(text)
                  .then(() => toast.success(t("audio.copied")))
                  .catch(() => toast.error(t("audio.copyFailed")))
              }
            >
              <Copy className="size-3.5" aria-hidden />
              {t("audio.copy")}
            </Button>
            <Button
              size="sm"
              onClick={() =>
                exportPlain(text, baseName, "txt", false)
                  .then((p) => p && toast.success(t("content.exported", { path: p })))
                  .catch((e: unknown) => toast.error(errorText(e)))
              }
            >
              {t("audio.exportTxt")}
            </Button>
            {result.hasTiming && (
              <>
                <Button
                  size="sm"
                  onClick={() =>
                    exportPlain(formatSrt(toSegments(result)), baseName, "srt", false)
                      .then((p) => p && toast.success(t("content.exported", { path: p })))
                      .catch((e: unknown) => toast.error(errorText(e)))
                  }
                >
                  {t("audio.exportSrt")}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    useSubs.getState().load(toSegments(result), baseName, lang || null);
                    setRoute("subtitles");
                  }}
                >
                  <Captions className="size-3.5" aria-hidden />
                  {t("audio.toSubtitles")}
                </Button>
              </>
            )}
            <Button size="sm" onClick={() => setSaving(true)}>
              <FolderPlus className="size-3.5" aria-hidden />
              {t("content.saveTitle")}
            </Button>
          </div>
        </div>
      )}

      {saving && (
        <SaveToProjectModal
          initialTitle={baseName}
          initialProjectId={null}
          onClose={() => setSaving(false)}
          onSave={async (target) => {
            await api.saveAsset({
              projectId: target.projectId,
              kind: "transcript",
              title: target.title || null,
              body: text,
              lang: lang || null,
              metaJson: null,
            });
          }}
        />
      )}
    </div>
  );
}
