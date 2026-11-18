import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Mic, Play, Star, Trash2, Upload } from "lucide-react";
import { api, isReady, type VoiceFavorite, type VoiceInfo, type VoiceProfile } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { formatDate } from "../../lib/utils";
import { defaultProvider, useProviders } from "../../stores/providers";
import { toast } from "../../stores/toast";
import { useUi } from "../../stores/ui";
import { useVoice } from "../../stores/voice";
import { Badge, Button, ConfirmModal, Field, Input, Modal, Select, Textarea } from "../../components/ui/controls";
import { audioUrl } from "../voice/audioUrl";
import { VOICE_LANGS } from "../voice/voiceLangs";

const PREVIEW_TEXT: Record<string, string> = {
  bn: "আমি কথক। এটি আমার কণ্ঠের একটি ছোট নমুনা।",
  en: "Hello, this is a short sample of my voice.",
  hi: "नमस्ते, यह मेरी आवाज़ का एक छोटा नमूना है।",
};

export default function VoiceLibraryPage() {
  const { t, i18n } = useTranslation();
  const setRoute = useUi((s) => s.setRoute);
  const voiceSel = useVoice();
  const providers = useProviders((s) => s.providers);
  const defaults = useProviders((s) => s.defaults);
  const ready = useMemo(() => providers.filter((p) => p.category === "tts" && isReady(p)), [providers]);
  const [providerId, setProviderId] = useState("");
  const provider = ready.find((p) => p.id === providerId) ?? defaultProvider({ providers, defaults }, "tts") ?? ready[0];

  const [lang, setLang] = useState("bn-BD");
  const [query, setQuery] = useState("");
  const [onlyFav, setOnlyFav] = useState(false);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [favorites, setFavorites] = useState<VoiceFavorite[]>([]);
  const [preview, setPreview] = useState<{ voice: string; url: string } | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<VoiceProfile | null>(null);

  const reloadFavs = useCallback(() => {
    api.voiceFavorites().then(setFavorites).catch(() => undefined);
  }, []);
  const reloadProfiles = useCallback(() => {
    api.voiceProfiles().then(setProfiles).catch(() => undefined);
  }, []);

  useEffect(() => {
    reloadFavs();
    reloadProfiles();
  }, [reloadFavs, reloadProfiles]);

  useEffect(() => {
    setVoices([]);
    if (!provider || provider.adapter !== "google_tts") return;
    let alive = true;
    setLoading(true);
    api
      .ttsListVoices(provider.id, lang)
      .then((v) => alive && setVoices(v))
      .catch((e: unknown) => alive && toast.error(errorText(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [provider?.id, provider?.adapter, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const url = preview?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [preview?.url]);

  const favSet = new Set(favorites.filter((f) => f.providerId === provider?.id).map((f) => f.voiceId));
  const shown = voices.filter(
    (v) => (!onlyFav || favSet.has(v.id)) && (!query.trim() || v.name.toLowerCase().includes(query.trim().toLowerCase())),
  );

  const toggleFav = (v: VoiceInfo) => {
    if (!provider) return;
    api
      .voiceFavoriteSet(provider.id, v.id, !favSet.has(v.id))
      .then(reloadFavs)
      .catch((e: unknown) => toast.error(errorText(e)));
  };

  const runPreview = async (v: VoiceInfo) => {
    if (!provider) return;
    setPreviewing(v.id);
    try {
      const text = PREVIEW_TEXT[lang.slice(0, 2)] ?? PREVIEW_TEXT["en"] ?? "";
      const out = await api.ttsSynthesize({ providerId: provider.id, voiceId: v.id, lang, text });
      const url = await audioUrl(out.file);
      setPreview({ voice: v.id, url });
      // Previews are throw-away: drop them from history so it only holds real work.
      await api.ttsHistoryDelete(out.historyId);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setPreviewing(null);
    }
  };

  const useVoiceInStudio = (v: VoiceInfo) => {
    if (!provider) return;
    voiceSel.set({ providerId: provider.id, voiceId: v.id, lang });
    setRoute("voice");
  };

  return (
    <div className="h-full space-y-8 overflow-y-auto p-6">
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">{t("vlib.voices")}</h2>
        {ready.length === 0 ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm">
            <div className="font-medium">{t("voice.noProvider")}</div>
            <p className="mt-1 text-xs text-muted-foreground">{t("voice.noProviderBody")}</p>
            <Button className="mt-3" size="sm" variant="primary" onClick={() => setRoute("apiManager")}>
              {t("content.goApi")}
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <Field label={t("content.provider")}>
                <Select value={provider?.id ?? ""} onChange={(e) => setProviderId(e.target.value)}>
                  {ready.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("voice.language")}>
                <Select value={lang} onChange={(e) => setLang(e.target.value)}>
                  {VOICE_LANGS.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("vlib.search")}>
                <Input value={query} onChange={(e) => setQuery(e.target.value)} />
              </Field>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" checked={onlyFav} onChange={(e) => setOnlyFav(e.target.checked)} />
                {t("vlib.onlyFav")}
              </label>
            </div>

            {provider?.adapter !== "google_tts" ? (
              <p className="text-sm text-muted-foreground">{t("vlib.noList")}</p>
            ) : loading ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : shown.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("vlib.none")}</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">{t("vlib.count", { count: shown.length })}</p>
                {provider?.costClass === "paid" && <p className="text-xs text-amber-500">{t("vlib.previewPaid")}</p>}
                <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                  {shown.map((v) => (
                    <li key={v.id} className="rounded-xl border bg-card p-3">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{v.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {v.languageCodes.join(", ")}
                            {v.gender ? ` · ${v.gender}` : ""}
                          </div>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => toggleFav(v)} aria-label={t("vlib.favorite")}>
                          <Star className={favSet.has(v.id) ? "size-4 fill-amber-400 text-amber-400" : "size-4"} aria-hidden />
                        </Button>
                        <Button size="sm" disabled={previewing !== null} onClick={() => void runPreview(v)}>
                          <Play className="size-3.5" aria-hidden />
                          {previewing === v.id ? t("content.generating") : t("vlib.preview")}
                        </Button>
                        <Button size="sm" variant="primary" onClick={() => useVoiceInStudio(v)}>
                          <Mic className="size-3.5" aria-hidden />
                          {t("vlib.use")}
                        </Button>
                      </div>
                      {preview?.voice === v.id && <audio controls autoPlay src={preview.url} className="mt-2 w-full" />}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="flex-1 text-lg font-semibold">{t("vlib.profiles")}</h2>
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            <Upload className="size-3.5" aria-hidden />
            {t("vlib.addProfile")}
          </Button>
        </div>
        <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">{t("vlib.cloneNote")}</p>
        {profiles.length === 0 && <p className="text-sm text-muted-foreground">{t("vlib.noProfiles")}</p>}
        <ul className="space-y-2">
          {profiles.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">
                  {t("vlib.consentOn", { date: formatDate(p.consentConfirmedAt, i18n.language) })}
                </div>
              </div>
              <Badge>{t("vlib.noEngine")}</Badge>
              <Button size="sm" variant="ghost" aria-label={t("common.delete")} onClick={() => setDeleting(p)}>
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      </section>

      {creating && (
        <ProfileModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            reloadProfiles();
          }}
        />
      )}
      {deleting && (
        <ConfirmModal
          danger
          title={t("vlib.deleteTitle")}
          body={t("vlib.deleteBody", { name: deleting.name })}
          confirmLabel={t("common.delete")}
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            api
              .voiceProfileDelete(id)
              .then(reloadProfiles)
              .catch((e: unknown) => toast.error(errorText(e)));
          }}
        />
      )}
    </div>
  );
}

function ProfileModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [lang, setLang] = useState("bn-BD");
  const [sample, setSample] = useState<{ file: string; label: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    try {
      const f = await api.importFile("Audio", ["wav", "mp3", "m4a", "flac", "ogg"]);
      if (!f) return;
      const ext = f.name.split(".").pop() ?? "wav";
      const file = await api.saveMedia(ext, f.dataB64);
      setSample({ file, label: f.name });
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const valid = name.trim() && sample && confirmed && statement.trim().length >= 10;

  const submit = async () => {
    if (!sample) return;
    setBusy(true);
    try {
      await api.voiceProfileCreate({
        name,
        lang,
        sampleFile: sample.file,
        consentConfirmed: confirmed,
        consentStatement: statement,
      });
      toast.success(t("vlib.created"));
      onCreated();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("vlib.addProfile")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!valid || busy} onClick={() => void submit()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <Field label={t("vlib.profileName")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t("voice.language")}>
        <Select value={lang} onChange={(e) => setLang(e.target.value)}>
          {VOICE_LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("vlib.sample")} hint={t("vlib.sampleHint")}>
        <div className="flex items-center gap-3">
          <Button onClick={() => void pick()}>
            <Upload className="size-4" aria-hidden />
            {t("vlib.pickSample")}
          </Button>
          <span className="truncate text-xs text-muted-foreground">{sample?.label}</span>
        </div>
      </Field>
      <Field label={t("vlib.statement")} hint={t("vlib.statementHint")}>
        <Textarea rows={3} value={statement} onChange={(e) => setStatement(e.target.value)} />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>{t("vlib.consent")}</span>
      </label>
    </Modal>
  );
}
