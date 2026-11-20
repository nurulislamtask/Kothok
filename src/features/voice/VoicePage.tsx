import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FolderPlus, Loader2, Mic, Play, Plus, Trash2, Users, X } from "lucide-react";
import { api, isReady, savedModel, type TtsHistoryItem, type VoiceFavorite, type VoiceInfo } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { safeName } from "../../lib/exporters";
import { cn, formatDate } from "../../lib/utils";
import { defaultProvider, useProviders } from "../../stores/providers";
import { toast } from "../../stores/toast";
import { useUi } from "../../stores/ui";
import { useVoice } from "../../stores/voice";
import NeedProvider from "../../components/NeedProvider";
import ModelPicker from "../../components/ModelPicker";
import { Badge, Button, Field, Input, Select, Textarea } from "../../components/ui/controls";
import SaveToProjectModal from "../../components/SaveToProjectModal";
import { audioUrl } from "./audioUrl";
import AudioTags, { TAG_GROUPS, tagSupport } from "./AudioTags";
import VoicePicker from "./VoicePicker";
import { catalogVoice, GEMINI_CATALOG, GEMINI_STYLES } from "./voiceCatalog";
import { VOICE_LANGS } from "./voiceLangs";

function Card({ title, children, aside }: { title?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      {(title || aside) && (
        <div className="mb-3 flex items-center gap-2">
          {title && <h3 className="text-sm font-semibold">{title}</h3>}
          <div className="ms-auto">{aside}</div>
        </div>
      )}
      {children}
    </section>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(h);
  }, []);
  return <>{Math.max(0, Math.floor((now - since) / 1000))}s</>;
}

export default function VoicePage() {
  const { t, i18n } = useTranslation();
  const setRoute = useUi((s) => s.setRoute);
  const providers = useProviders((s) => s.providers);
  const defaults = useProviders((s) => s.defaults);
  const sel = useVoice();
  const { blocks, job, result } = sel;

  const ready = useMemo(() => providers.filter((p) => (p.category === "tts" || p.category === "clone") && isReady(p)), [providers]);
  const provider = ready.find((p) => p.id === sel.providerId) ?? defaultProvider({ providers, defaults }, "tts") ?? ready[0];

  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [favorites, setFavorites] = useState<VoiceFavorite[]>([]);
  const [model, setModel] = useState("");
  const [speed, setSpeed] = useState(1);
  const [pitch, setPitch] = useState(0);
  const [gapMs, setGapMs] = useState(350);
  const [current, setCurrent] = useState<{ file: string; url: string; parts: number } | null>(null);
  const [history, setHistory] = useState<TtsHistoryItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [active, setActive] = useState<string>(blocks[0]?.id ?? "");
  const refs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const adapter = provider?.adapter;
  const isGoogle = adapter === "google_tts";
  const isGemini = adapter === "gemini_tts";
  const hasList = adapter !== "openai_tts";
  const effectiveModel = model || (provider ? savedModel(provider) : "");
  const support = tagSupport(adapter, effectiveModel);
  const catalogVoices: VoiceInfo[] = useMemo(
    () => GEMINI_CATALOG.map((c) => ({ id: c.id, name: c.id, languageCodes: [], gender: c.gender })),
    [],
  );
  // Gemini's 30 voices are fixed: the list never depends on the chosen model or a network call.
  const voiceList = isGemini ? catalogVoices : voices;
  const favSet = useMemo(
    () => new Set(favorites.filter((f) => f.providerId === provider?.id).map((f) => f.voiceId)),
    [favorites, provider?.id],
  );
  const totalChars = blocks.reduce((n, b) => n + b.text.length, 0);

  const loadHistory = useCallback(() => {
    api.ttsHistory().then(setHistory).catch(() => undefined);
  }, []);
  const loadFavs = useCallback(() => {
    api.voiceFavorites().then(setFavorites).catch(() => undefined);
  }, []);

  useEffect(() => {
    loadHistory();
    loadFavs();
  }, [loadHistory, loadFavs, sel.doneTick]);

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

  // Show the latest result even if it finished while another page was open.
  useEffect(() => {
    if (!result) return;
    let url = "";
    let alive = true;
    audioUrl(result.file)
      .then((u) => {
        if (!alive) {
          URL.revokeObjectURL(u);
          return;
        }
        url = u;
        setCurrent({ file: result.file, url: u, parts: result.parts });
      })
      .catch((e: unknown) => toast.error(errorText(e)));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [result]);

  const toggleFav = (id: string) => {
    if (!provider) return;
    api
      .voiceFavoriteSet(provider.id, id, !favSet.has(id))
      .then(loadFavs)
      .catch((e: unknown) => toast.error(errorText(e)));
  };

  const insertTag = (tag: string) => {
    const id = active || blocks[0]?.id;
    if (!id) return;
    const ta = refs.current[id];
    const cur = useVoice.getState().blocks.find((b) => b.id === id)?.text ?? "";
    const a = ta?.selectionStart ?? cur.length;
    const b = ta?.selectionEnd ?? cur.length;
    const piece = `${a > 0 && !/\s$/.test(cur.slice(0, a)) ? " " : ""}${tag} `;
    useVoice.getState().setBlock(id, { text: cur.slice(0, a) + piece + cur.slice(b) });
    requestAnimationFrame(() => {
      ta?.focus();
      const pos = a + piece.length;
      ta?.setSelectionRange(pos, pos);
    });
  };

  const generate = () => {
    if (!provider) return;
    void sel.run({
      providerId: provider.id,
      lang: sel.lang,
      model: model.trim() || undefined,
      speed,
      pitch: isGoogle ? pitch : undefined,
      gapMs,
      styleCapable: isGemini,
      tagCapable: support.level === "yes" && support.syntax === "square",
    });
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
      setCurrent({ file: item.audioPath, url, parts: 1 });
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  if (ready.length === 0) {
    return <NeedProvider category="tts" title={t("voice.noProvider")} body={t("voice.noProviderBody")} />;
  }

  const nameOf = (id: string) => {
    const c = catalogVoice(id);
    return c ? `${id} · ${c.style}` : id;
  };

  return (
    <div className="grid h-full grid-cols-1 gap-5 overflow-y-auto p-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="space-y-4">
        <Card
          title={t("voice.script")}
          aside={
            <span className="text-xs text-muted-foreground">
              {t("voice.chars", { count: totalChars })} · {t("voice.blockCount", { count: blocks.length })}
            </span>
          }
        >
          <p className="mb-3 text-xs text-muted-foreground">{t("voice.scriptHint")}</p>
          <div className="space-y-3">
            {blocks.map((b, i) => {
              const voiceId = b.voiceId || sel.voiceId;
              return (
                <div key={b.id} className={cn("rounded-lg border p-3", active === b.id ? "border-primary/60" : "")}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge>{i + 1}</Badge>
                    <Button size="sm" onClick={() => setPickFor(pickFor === b.id ? null : b.id)}>
                      <Users className="size-3.5" aria-hidden />
                      {voiceId ? nameOf(voiceId) : t("voice.choose")}
                    </Button>
                    {isGemini && (
                      <Select
                        value={GEMINI_STYLES.some((s) => s.text === b.style) ? b.style : b.style ? "__custom" : ""}
                        onChange={(e) => sel.setBlock(b.id, { style: e.target.value === "__custom" ? " " : e.target.value })}
                        className="h-8 w-44 text-xs"
                        aria-label={t("voice.style")}
                      >
                        <option value="">{t("voice.noStyle")}</option>
                        {GEMINI_STYLES.map((s) => (
                          <option key={s.id} value={s.text}>
                            {t(`voice.styles.${s.id}`)}
                          </option>
                        ))}
                        <option value="__custom">{t("voice.customStyle")}</option>
                      </Select>
                    )}
                    {!isGemini && support.level === "yes" && support.syntax === "square" && (
                      <Select
                        value={b.style}
                        onChange={(e) => sel.setBlock(b.id, { style: e.target.value })}
                        className="h-8 w-44 text-xs"
                        aria-label={t("voice.emotion")}
                      >
                        <option value="">{t("voice.noEmotion")}</option>
                        {TAG_GROUPS[0]!.tags.map((tag) => (
                          <option key={tag} value={tag}>
                            {tag}
                          </option>
                        ))}
                      </Select>
                    )}
                    {isGemini && b.style && !GEMINI_STYLES.some((s) => s.text === b.style) && (
                      <Input
                        value={b.style}
                        onChange={(e) => sel.setBlock(b.id, { style: e.target.value })}
                        placeholder={t("voice.customStylePlaceholder")}
                        className="h-8 w-56 text-xs"
                      />
                    )}
                    <div className="ms-auto flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => sel.addBlock(b.id)} aria-label={t("voice.addBlock")} title={t("voice.addBlock")}>
                        <Plus className="size-3.5" aria-hidden />
                      </Button>
                      {blocks.length > 1 && (
                        <Button size="sm" variant="ghost" onClick={() => sel.removeBlock(b.id)} aria-label={t("common.delete")}>
                          <X className="size-3.5" aria-hidden />
                        </Button>
                      )}
                    </div>
                  </div>
                  <Textarea
                    ref={(el) => {
                      refs.current[b.id] = el;
                    }}
                    rows={blocks.length > 1 ? 4 : 10}
                    value={b.text}
                    onFocus={() => setActive(b.id)}
                    onChange={(e) => sel.setBlock(b.id, { text: e.target.value })}
                    placeholder={t("voice.textPlaceholder")}
                  />
                  {pickFor === b.id && (
                    <div className="mt-3">
                      <VoicePicker
                        voices={voiceList}
                        value={voiceId}
                        onChange={(id) => {
                          sel.setBlock(b.id, { voiceId: id });
                          if (!sel.voiceId) sel.set({ voiceId: id });
                          setPickFor(null);
                        }}
                        favorites={favSet}
                        onToggleFav={toggleFav}
                        providerId={provider?.id}
                        lang={sel.lang}
                        adapter={provider?.adapter}
                        canPreview={!!provider}
                        onClose={() => setPickFor(null)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={() => sel.addBlock()}>
              <Plus className="size-3.5" aria-hidden />
              {t("voice.addBlock")}
            </Button>
            {blocks.length > 1 && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                {t("voice.gap")}
                <input type="range" min={0} max={2000} step={50} value={gapMs} onChange={(e) => setGapMs(Number(e.target.value))} />
                {gapMs} ms
              </label>
            )}
          </div>
        </Card>

        {support.level !== "no" && <AudioTags support={support.level} syntax={support.syntax} onInsert={insertTag} />}
        {support.level === "no" && !isGemini && <p className="text-xs text-muted-foreground">{t("voice.noEmotionHint")}</p>}
        {support.level === "no" && blocks.some((b) => /[[<]\w[^\]>]*[\]>]/.test(b.text)) && (
          <p className="text-xs text-amber-500">{t("tags.support.no")}</p>
        )}

        <Card title={t("voice.settings")}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label={t("content.provider")}>
              <Select
                value={provider?.id ?? ""}
                onChange={(e) => {
                  sel.set({ providerId: e.target.value, voiceId: "" });
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
            <Field label={t("voice.language")}>
              <Select value={sel.lang} onChange={(e) => sel.set({ lang: e.target.value })}>
                {VOICE_LANGS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("content.model")} hint={isGoogle ? t("voice.modelHintGoogle") : undefined}>
              <ModelPicker provider={provider} value={model} onChange={setModel} />
            </Field>
            <Field label={t("voice.defaultVoice")} hint={hasList ? undefined : t("voice.voiceHintManual")}>
              {hasList ? (
                <Select value={sel.voiceId} onChange={(e) => sel.set({ voiceId: e.target.value })}>
                  <option value="">{t("voice.choose")}</option>
                  {[...voiceList]
                    .sort((a, b) => Number(favSet.has(b.id)) - Number(favSet.has(a.id)))
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {favSet.has(v.id) ? "★ " : ""}
                        {nameOf(v.id)}
                      </option>
                    ))}
                </Select>
              ) : (
                <Input value={sel.voiceId} onChange={(e) => sel.set({ voiceId: e.target.value })} placeholder={t("voice.voicePlaceholder")} />
              )}
            </Field>
            {!isGemini && (
              <Field label={`${t("voice.speed")}: ${speed.toFixed(2)}×`}>
                <input type="range" min={0.5} max={2} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-full" />
              </Field>
            )}
            {isGoogle && (
              <Field label={`${t("voice.pitch")}: ${pitch.toFixed(1)}`}>
                <input type="range" min={-10} max={10} step={0.5} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} className="w-full" />
              </Field>
            )}
          </div>
          {isGoogle && <p className="mt-3 text-xs text-muted-foreground">{t("voice.geminiNote")}</p>}
          {isGemini && <p className="mt-3 text-xs text-muted-foreground">{t("voice.geminiApiNote")}</p>}
          {provider?.costClass === "paid" && <p className="mt-3 text-xs text-amber-500">{t("voice.paidNote")}</p>}
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={job !== null} onClick={generate}>
            {job ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Mic className="size-4" aria-hidden />}
            {job ? t("content.generating") : t("voice.generate")}
          </Button>
          {job && (
            <Button variant="danger" onClick={() => sel.cancel()}>
              {t("common.stop")}
            </Button>
          )}
        </div>
      </div>

      <aside className="space-y-4">
        {job && (
          <Card title={t("voice.working")}>
            <div role="status" aria-live="polite" className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                <span>{t("voice.stepOf", { step: job.step, total: job.total })}</span>
                <span className="ms-auto text-xs text-muted-foreground">
                  <Elapsed since={job.startedAt} />
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${Math.max(8, ((job.step - 1) / job.total) * 100)}%` }} />
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">{job.label}</p>
              <p className="text-xs text-muted-foreground">{t("voice.keepOpen")}</p>
            </div>
          </Card>
        )}

        {current && (
          <Card title={t("voice.result")}>
            <audio controls src={current.url} className="w-full" />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void download(current.file, blocks[0]?.text.slice(0, 30) ?? "")}>
                <Download className="size-3.5" aria-hidden />
                {t("voice.download")}
              </Button>
              <Button size="sm" onClick={() => setSaving(true)}>
                <FolderPlus className="size-3.5" aria-hidden />
                {t("content.saveTitle")}
              </Button>
              <Button size="sm" onClick={() => setRoute("thumbnail")}>
                {t("voice.makeThumb")}
              </Button>
            </div>
            {current.parts > 1 && <p className="mt-2 text-xs text-muted-foreground">{t("voice.joined", { count: current.parts })}</p>}
          </Card>
        )}

        <Card title={t("voice.history")}>
          {history.length === 0 && <p className="text-sm text-muted-foreground">{t("voice.noHistory")}</p>}
          <div className="space-y-2">
            {history.map((h) => (
              <div key={h.id} className="rounded-lg border bg-muted/20 p-3">
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
          </div>
        </Card>
      </aside>

      {saving && current && (
        <SaveToProjectModal
          initialTitle={blocks[0]?.text.trim().slice(0, 40) ?? ""}
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
