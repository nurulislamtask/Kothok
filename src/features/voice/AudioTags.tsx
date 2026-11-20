import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { Input } from "../../components/ui/controls";

/** Audio tags in the style ElevenLabs documents for Eleven v3: the tag is written into the text. */
export const TAG_GROUPS: ReadonlyArray<{ id: "emotion" | "vocal" | "delivery"; tags: readonly string[] }> = [
  { id: "emotion", tags: ["weak", "angry", "bored", "menacing", "playful", "tired", "excited", "sad", "happy", "nervous", "curious", "sarcastic"] },
  {
    id: "vocal",
    tags: ["clears throat", "coughing", "chuckling", "sighing", "sniffing", "yawning", "laughing", "sharp exhale", "scoffing", "humming", "panting", "gasping", "crying"],
  },
  { id: "delivery", tags: ["whispering", "singing", "slowly", "softly", "shouting", "fast", "voice breaking", "pause"] },
];

/** Inline sound tags that Google's Gemini speech documentation and AI Studio use: `<laugh>`. */
export const GEMINI_TAGS: ReadonlyArray<{ id: "emotion" | "vocal" | "delivery"; tags: readonly string[] }> = [
  { id: "vocal", tags: ["laugh", "chuckle", "cackle", "sigh", "gasp", "breath", "argh", "cheer"] },
  { id: "delivery", tags: ["short pause"] },
];

export type TagSyntax = "square" | "angle";

/** Whether the selected engine understands inline tags, and in which syntax. */
export function tagSupport(adapter: string | undefined, model: string): { level: "yes" | "maybe" | "no"; syntax: TagSyntax } {
  if (adapter === "elevenlabs_clone") return { level: model.includes("v3") ? "yes" : "no", syntax: "square" };
  if (adapter === "gemini_tts") return { level: "maybe", syntax: "angle" };
  return { level: "no", syntax: "square" };
}

export default function AudioTags({
  onInsert,
  support,
  syntax,
}: {
  onInsert: (tag: string) => void;
  support: "yes" | "maybe" | "no";
  syntax: TagSyntax;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const groups = useMemo(
    () =>
      (syntax === "angle" ? GEMINI_TAGS : TAG_GROUPS).map((g) => ({
        ...g,
        tags: g.tags.filter((x) => x.includes(q.trim().toLowerCase())),
      })).filter((g) => g.tags.length > 0),
    [q, syntax],
  );

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <div className="text-xs font-medium">{t("tags.title")}</div>
        <div className="relative ms-auto w-44">
          <Search className="pointer-events-none absolute start-2 top-2.5 size-3.5 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("tags.search")} className="h-8 ps-7 text-xs" />
        </div>
      </div>
      <p className={support === "yes" ? "mb-2 text-xs text-muted-foreground" : "mb-2 text-xs text-amber-500"}>
        {t(`tags.support.${support}${syntax === "angle" ? "Angle" : ""}`)}
      </p>
      <div className="max-h-48 space-y-2 overflow-y-auto">
        {groups.map((g) => (
          <div key={g.id}>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{t(`tags.groups.${g.id}`)}</div>
            <div className="flex flex-wrap gap-1.5">
              {g.tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onInsert(syntax === "angle" ? `<${tag}>` : `[${tag}]`)}
                  className="rounded-md border bg-muted/40 px-2 py-1 text-xs hover:bg-muted"
                >
                  {syntax === "angle" ? `<${tag}>` : `[${tag}]`}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
