import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FolderPlus, Mic, Play, Trash2 } from "lucide-react";
import { api, isReady, type TtsHistoryItem, type VoiceFavorite, type VoiceInfo } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { safeName } from "../../lib/exporters";
import { formatDate } from "../../lib/utils";
import { defaultProvider, useProviders } from "../../stores/providers";
import { toast } from "../../stores/toast";
import { useUi } from "../../stores/ui";
import { useVoice } from "../../stores/voice";
import ModelPicker from "../../components/ModelPicker";
import { Button, Field, Input, Select, Textarea } from "../../components/ui/controls";
import SaveToProjectModal from "../../components/SaveToProjectModal";
import { audioUrl } from "./audioUrl";
import { VOICE_LANGS } from "./voiceLangs";

export default function VoicePage() {
  const { t, i18n } = useTranslation();
  const setRoute = useUi((s) => s.setRoute);
  const providers = useProviders((s) => s.providers);
  const defaults = useProviders((s) => s.defaults);
  const sel = useVoice();

  const ready = useMemo(() => providers.filter((p) => p.category === "tts" && isReady(p)), [providers]);
  const provider =
    ready.find((p) => p.id === sel.providerId) ?? defaultProvider({ providers, defaults }, "tts") ?? ready[0];

  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [favorites, setFavorites] = useState<VoiceFavorite[]>([]);
  const [model, setModel] = useState("");
  const [speed, setSpeed] = useState(1);
  const [pitch, setPitch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<{ file: string; url: string; chunks: number } | null>(null);
  const [history, setHistory] = useState<TtsHistoryItem[]>([]);
  const [saving, setSaving] = useState(false);
  const isGoogle = provider?.adapter === "google_tts";
  const hasList = provider?.adapter !== "openai_tts";
  const isGeminiApi = provider?.adapter === "gemini_tts";

  const loadHistory = useCallback(() => {
    api
      .ttsHistory()
      .then(setHistory)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadHistory();
    api
      .voiceFavorites()
      .then(setFavorites)
      .catch(() => undefined);
  }, [loadHistory]);

  useEffect(() => {
    setVoices([]);
    if (!provider || !hasList) return;
    let alive = true;
    api
      .ttsListVoices(provider.id, sel.lang)
      .then((v) => alive && setVoices(v))
      .catch((e: unknown) => alive && toast.error(errorText(e)));
    return () => {
      alive = false;
    };
  }, [provider?.id, hasList, sel.lang]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const url = current?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [current?.url]);

  const favSet = new Set(favorites.filter((f) => f.providerId === provider?.id).map((f) => f.voiceId));
  const sortedVoices = [...voices].sort((a, b) => Number(favSet.has(b.id)) - Number(favSet.has(a.id)));

  const generate = async () => {
    if (!provider) return;
    if (!sel.text.trim()) {
      toast.error(t("voice.needText"));
      return;
    }
    if (!sel.voiceId.trim()) {
      toast.error(t("voice.needVoice"));
      return;
    }
    setBusy(true);
    try {
      const out = await api.ttsSynthesize({
        providerId: provider.id,
        voiceId: sel.voiceId.trim(),
        lang: sel.lang,
        model: model.trim() || undefined,
        text: sel.text,
        speed,
        pitch: isGoogle ? pitch : undefined,
      });
      const url = await audioUrl(out.file);
      setCurrent({ file: out.file, url, chunks: out.chunks });
      loadHistory();
      toast.success(t("voice.done", { provider: out.providerName }));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const download = async (file: string, name: string) => {
    try {
      const f = await api.readMedia(file);
      const ext = file.toLowerCase().endsWith(".wav") ? "wav" : "mp3";
      const saved = await api.exportFile(`${safeName(name, "kothok-voice")}.${ext}`, ext.toUpperCase(), [ext], f.dataB64);
      if (saved) toast.success(t("content.exported", { path: saved }));
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const play = async (item: TtsHistoryItem) => {
    if (!item.audioPath) return;
    try {
      const url = await audioUrl(item.audioPath);
      setCurrent({ file: item.audioPath, url, chunks: 1 });
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  if (ready.length === 0) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-xl border border-amber-500/40 bg-amber-500/10 p-6 text-sm">
        <div className="font-medium">{t("voice.noProvider")}</div>
        <p className="mt-1 text-xs text-muted-foreground">{t("voice.noProviderBody")}</p>
        <Button className="mt-4" variant="primary" size="sm" onClick={() => setRoute("apiManager")}>
          {t("content.goApi")}
        </Button>
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-1 gap-6 overflow-y-auto p-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="space-y-4">
        <Field label={t("voice.text")} hint={t("voice.chars", { count: sel.text.length })}>
          <Textarea rows={12} value={sel.text} onChange={(e) => sel.set({ text: e.target.value })} placeholder={t("voice.textPlaceholder")} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("content.provider")}>
            <Select value={provider?.id ?? ""} onChange={(e) => { sel.set({ providerId: e.target.value, voiceId: "" }); setModel(""); }}>
              {ready.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("voice.language")}>
            <Select value={sel.lang} onChange={(e) => sel.set({ lang: e.target.value, voiceId: "" })}>
              {VOICE_LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("voice.voice")} hint={hasList ? t("voice.voiceHintGoogle", { count: voices.length }) : t("voice.voiceHintManual")}>
            {sortedVoices.length > 0 ? (
              <Select value={sel.voiceId} onChange={(e) => sel.set({ voiceId: e.target.value })}>
                <option value="">{t("voice.choose")}</option>
                {sortedVoices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {favSet.has(v.id) ? "★ " : ""}
                    {v.name}
                    {v.gender ? ` (${v.gender})` : ""}
                  </option>
                ))}
              </Select>
            ) : (
              <Input value={sel.voiceId} onChange={(e) => sel.set({ voiceId: e.target.value })} placeholder={t("voice.voicePlaceholder")} />
            )}
          </Field>
          <Field label={t("content.model")} hint={isGoogle ? t("voice.modelHintGoogle") : undefined}>
            <ModelPicker provider={provider} value={model} onChange={setModel} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t("voice.speed")}: ${speed.toFixed(2)}×`}>
            <input type="range" min={0.5} max={2} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-full" />
          </Field>
          {isGoogle && (
            <Field label={`${t("voice.pitch")}: ${pitch.toFixed(1)}`}>
              <input type="range" min={-10} max={10} step={0.5} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} className="w-full" />
            </Field>
          )}
        </div>
        {isGoogle && <p className="text-xs text-muted-foreground">{t("voice.geminiNote")}</p>}
        {isGeminiApi && <p className="text-xs text-muted-foreground">{t("voice.geminiApiNote")}</p>}
        {provider?.costClass === "paid" && <p className="text-xs text-amber-500">{t("voice.paidNote")}</p>}

        <Button variant="primary" disabled={busy} onClick={() => void generate()}>
          <Mic className="size-4" aria-hidden />
          {busy ? t("content.generating") : t("voice.generate")}
        </Button>

        {current && (
          <div className="rounded-xl border bg-card p-4">
            <audio controls src={current.url} className="w-full" />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void download(current.file, sel.text.slice(0, 30))}>
                <Download className="size-3.5" aria-hidden />
                {t("voice.download")}
              </Button>
              <Button size="sm" onClick={() => setSaving(true)}>
                <FolderPlus className="size-3.5" aria-hidden />
                {t("content.saveTitle")}
              </Button>
              {current.chunks > 1 && <span className="self-center text-xs text-muted-foreground">{t("voice.chunks", { count: current.chunks })}</span>}
            </div>
          </div>
        )}
      </section>

      <aside className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("voice.history")}</h3>
        {history.length === 0 && <p className="text-sm text-muted-foreground">{t("voice.noHistory")}</p>}
        {history.map((h) => (
          <div key={h.id} className="rounded-lg border bg-card p-3">
            <div className="line-clamp-2 text-sm">{h.textPreview}</div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {h.voiceId} · {formatDate(h.createdAt, i18n.language)}
            </div>
            <div className="mt-2 flex gap-1">
              <Button size="sm" onClick={() => void play(h)} aria-label={t("voice.play")}>
                <Play className="size-3.5" aria-hidden />
              </Button>
              {h.audioPath && (
                <Button size="sm" onClick={() => void download(h.audioPath ?? "", h.textPreview ?? "")} aria-label={t("voice.download")}>
                  <Download className="size-3.5" aria-hidden />
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                aria-label={t("common.delete")}
                onClick={() => {
                  if (current && current.file === h.audioPath) setCurrent(null);
                  api
                    .ttsHistoryDelete(h.id)
                    .then(loadHistory)
                    .catch((e: unknown) => toast.error(errorText(e)));
                }}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </div>
          </div>
        ))}
      </aside>

      {saving && current && (
        <SaveToProjectModal
          initialTitle={sel.text.trim().slice(0, 40)}
          initialProjectId={null}
          onClose={() => setSaving(false)}
          onSave={async (target) => {
            await api.saveAsset({
              projectId: target.projectId,
              kind: "audio",
              title: target.title || null,
              filePath: current.file,
              body: null,
              lang: sel.lang,
              metaJson: null,
            });
          }}
        />
      )}
    </div>
  );
}
