import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2, Upload } from "lucide-react";
import { api, isReady, type VoiceFavorite, type VoiceInfo, type VoiceProfile } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { formatDate } from "../../lib/utils";
import { defaultProvider, useProviders } from "../../stores/providers";
import { toast } from "../../stores/toast";
import { useUi } from "../../stores/ui";
import { useVoice } from "../../stores/voice";
import { Badge, Button, ConfirmModal, Field, Input, Modal, Select, Textarea } from "../../components/ui/controls";
import VoicePicker from "../voice/VoicePicker";
import { GEMINI_CATALOG } from "../voice/voiceCatalog";
import { VOICE_LANGS } from "../voice/voiceLangs";

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
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [favorites, setFavorites] = useState<VoiceFavorite[]>([]);

  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<VoiceProfile | null>(null);
  const [cloning, setCloning] = useState<VoiceProfile | null>(null);

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
    if (!provider || provider.adapter === "openai_tts") return;
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

  const favSet = new Set(favorites.filter((f) => f.providerId === provider?.id).map((f) => f.voiceId));
  const listed: VoiceInfo[] =
    !provider || provider.adapter === "gemini_tts"
      ? GEMINI_CATALOG.map((c) => ({ id: c.id, name: c.id, languageCodes: [], gender: c.gender }))
      : voices;

  const toggleFav = (id: string) => {
    if (!provider) return;
    api
      .voiceFavoriteSet(provider.id, id, !favSet.has(id))
      .then(reloadFavs)
      .catch((e: unknown) => toast.error(errorText(e)));
  };

  return (
    <div className="h-full space-y-8 overflow-y-auto p-6">
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{t("vlib.voices")}</h2>
          <p className="text-xs text-muted-foreground">{t("vlib.builtinNote")}</p>
        </div>
        {ready.length === 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            <span className="flex-1">{t("vlib.needKeyToHear")}</span>
            <Button size="sm" variant="primary" onClick={() => setRoute("apiManager")}>
              {t("content.goApi")}
            </Button>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {ready.length > 0 && (
            <Field label={t("content.provider")}>
              <Select value={provider?.id ?? ""} onChange={(e) => setProviderId(e.target.value)}>
                {ready.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t("voice.language")}>
            <Select value={lang} onChange={(e) => setLang(e.target.value)}>
              {VOICE_LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {provider?.adapter === "openai_tts" ? (
          <p className="text-sm text-muted-foreground">{t("vlib.noList")}</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <>
            {provider?.costClass === "paid" && <p className="text-xs text-amber-500">{t("vlib.previewPaid")}</p>}
            <VoicePicker
              voices={listed}
              value={provider && voiceSel.providerId === provider.id ? voiceSel.voiceId : ""}
              onChange={(id) => {
                voiceSel.set({ providerId: provider?.id ?? "", voiceId: id, lang });
                setRoute("voice");
              }}
              favorites={favSet}
              onToggleFav={(id) => toggleFav(id)}
              providerId={provider?.id}
              adapter={provider?.adapter}
              lang={lang}
              canPreview={!!provider}
            />
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
              {p.remoteVoiceId ? (
                <Badge tone="ok">{t("vlib.cloned")}</Badge>
              ) : (
                <>
                  <Badge>{t("vlib.noEngine")}</Badge>
                  <Button size="sm" onClick={() => setCloning(p)}>
                    {t("vlib.makeClone")}
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" aria-label={t("common.delete")} onClick={() => setDeleting(p)}>
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      </section>

      {cloning && (
        <CloneModal
          profile={cloning}
          onClose={() => setCloning(null)}
          onDone={() => {
            setCloning(null);
            reloadProfiles();
          }}
        />
      )}
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

function CloneModal({ profile, onClose, onDone }: { profile: VoiceProfile; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const setRoute = useUi((s) => s.setRoute);
  const providers = useProviders((s) => s.providers);
  const ready = providers.filter((p) => p.category === "clone" && isReady(p));
  const [pid, setPid] = useState(ready[0]?.id ?? "");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.voiceProfileClone(profile.id, pid);
      toast.success(t("vlib.cloneDone"));
      onDone();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("vlib.cloneTitle", { name: profile.name })}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!ok || !pid || busy} onClick={() => void submit()}>
            {busy ? t("vlib.cloning") : t("vlib.makeClone")}
          </Button>
        </>
      }
    >
      <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">{t("vlib.cloneWhy")}</p>
      {ready.length === 0 ? (
        <div className="space-y-3 text-sm">
          <p>{t("vlib.noCloneProvider")}</p>
          <Button variant="primary" onClick={() => setRoute("apiManager")}>
            {t("content.goApi")}
          </Button>
        </div>
      ) : (
        <>
          <Field label={t("content.provider")}>
            <Select value={pid} onChange={(e) => setPid(e.target.value)}>
              {ready.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </Select>
          </Field>
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">{t("vlib.cloneWarn")}</p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={ok} onChange={(e) => setOk(e.target.checked)} />
            <span>{t("vlib.cloneConfirm")}</span>
          </label>
        </>
      )}
    </Modal>
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
