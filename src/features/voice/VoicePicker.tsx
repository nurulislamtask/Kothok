import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, Play, Star } from "lucide-react";
import { api, type VoiceInfo } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { cn } from "../../lib/utils";
import { toast } from "../../stores/toast";
import { Badge, Button, Input } from "../../components/ui/controls";
import { audioUrl } from "./audioUrl";
import { catalogVoice, USE_CASES, type Gender, type UseCase } from "./voiceCatalog";

const PREVIEW: Record<string, string> = {
  bn: "আমি কথক। এটি আমার কণ্ঠের একটি ছোট নমুনা।",
  en: "Hello, this is a short sample of my voice.",
  hi: "नमस्ते, यह मेरी आवाज़ का एक छोटा नमूना है।",
};

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors",
        on ? "border-primary bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Browse, filter, hear and pick a voice. Gemini voices carry Google's style word plus a reported
 * gender and suggested uses; other engines show what their API returns.
 */
export default function VoicePicker({
  voices,
  value,
  onChange,
  favorites,
  onToggleFav,
  providerId,
  lang,
  canPreview,
  onClose,
}: {
  voices: VoiceInfo[];
  value: string;
  onChange: (id: string) => void;
  favorites: Set<string>;
  onToggleFav: (id: string) => void;
  providerId: string | undefined;
  lang: string;
  canPreview: boolean;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [use, setUse] = useState<UseCase | "">("");
  const [onlyFav, setOnlyFav] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);

  useEffect(() => {
    const url = playing?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [playing?.url]);

  const hasMeta = voices.some((v) => catalogVoice(v.id));
  const shown = useMemo(
    () =>
      voices
        .filter((v) => {
          const c = catalogVoice(v.id);
          const g = c?.gender ?? v.gender?.toLowerCase();
          if (onlyFav && !favorites.has(v.id)) return false;
          if (gender && g !== gender) return false;
          if (use && !c?.uses.includes(use)) return false;
          const needle = q.trim().toLowerCase();
          return !needle || v.name.toLowerCase().includes(needle) || (c?.style.toLowerCase().includes(needle) ?? false);
        })
        .sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id))),
    [voices, q, gender, use, onlyFav, favorites],
  );

  const preview = async (id: string) => {
    if (!providerId) return;
    setBusy(id);
    try {
      const text = PREVIEW[lang.slice(0, 2)] ?? PREVIEW["en"] ?? "";
      const out = await api.ttsSynthesize({ providerId, voiceId: id, lang, text });
      const url = await audioUrl(out.file);
      setPlaying({ id, url });
      await api.ttsHistoryDelete(out.historyId);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("vpick.search")} className="h-8 w-48 text-xs" />
        {hasMeta && (
          <>
            <Chip on={gender === "female"} onClick={() => setGender(gender === "female" ? "" : "female")}>
              {t("vpick.female")}
            </Chip>
            <Chip on={gender === "male"} onClick={() => setGender(gender === "male" ? "" : "male")}>
              {t("vpick.male")}
            </Chip>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            {USE_CASES.map((u) => (
              <Chip key={u} on={use === u} onClick={() => setUse(use === u ? "" : u)}>
                {t(`vpick.uses.${u}`)}
              </Chip>
            ))}
          </>
        )}
        <Chip on={onlyFav} onClick={() => setOnlyFav(!onlyFav)}>
          <Star className="me-1 inline size-3" aria-hidden />
          {t("vpick.favorites")}
        </Chip>
        {onClose && (
          <Button size="sm" variant="ghost" className="ms-auto" onClick={onClose}>
            {t("common.close")}
          </Button>
        )}
      </div>
      {hasMeta && <p className="text-[11px] text-muted-foreground">{t("vpick.metaNote")}</p>}
      {!canPreview && <p className="text-[11px] text-amber-500">{t("vpick.noPreview")}</p>}

      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("vlib.none")}</p>
      ) : (
        <ul className="grid max-h-[26rem] grid-cols-1 gap-2 overflow-y-auto pe-1 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((v) => {
            const c = catalogVoice(v.id);
            const selected = value === v.id;
            const gender = c?.gender ?? v.gender?.toLowerCase();
            return (
              <li
                key={v.id}
                className={cn("rounded-lg border p-3 transition-colors", selected ? "border-primary bg-primary/10" : "bg-muted/20")}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <span className="truncate">{v.name}</span>
                      {selected && <Check className="size-3.5 text-primary" aria-hidden />}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c && <Badge>{c.style}</Badge>}
                      {gender && <Badge>{gender === "female" ? t("vpick.female") : gender === "male" ? t("vpick.male") : gender}</Badge>}
                    </div>
                    {c && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {c.uses.map((u) => t(`vpick.uses.${u}`)).join(" · ")}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleFav(v.id)}
                    aria-label={t("vlib.favorite")}
                    aria-pressed={favorites.has(v.id)}
                    className="rounded p-1 hover:bg-muted"
                  >
                    <Star className={favorites.has(v.id) ? "size-4 fill-amber-400 text-amber-400" : "size-4"} aria-hidden />
                  </button>
                </div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" disabled={!canPreview || busy !== null} onClick={() => void preview(v.id)}>
                    {busy === v.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
                    {t("vlib.preview")}
                  </Button>
                  <Button size="sm" variant={selected ? "secondary" : "primary"} onClick={() => onChange(v.id)}>
                    {selected ? t("vpick.selected") : t("vpick.pick")}
                  </Button>
                </div>
                {playing?.id === v.id && <audio controls autoPlay src={playing.url} className="mt-2 h-8 w-full" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
