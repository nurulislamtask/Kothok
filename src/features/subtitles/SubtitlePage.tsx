import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileUp, FolderPlus, Merge, Music, Plus, Scissors, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { exportPlain } from "../../lib/exporters";
import { cn } from "../../lib/utils";
import { useSubs } from "../../stores/subtitles";
import { toast } from "../../stores/toast";
import { Button, Field, Input, Textarea } from "../../components/ui/controls";
import SaveToProjectModal from "../../components/SaveToProjectModal";
import { audioUrl } from "../voice/audioUrl";
import {
  findProblems,
  formatSrt,
  formatTime,
  formatTxt,
  formatVtt,
  mergeWithNext,
  parseSubtitles,
  parseTime,
  replaceAll,
  shiftAll,
  splitSegment,
} from "./srt";

export default function SubtitlePage() {
  const { t } = useTranslation();
  const { segs, title, lang, projectId, assetId, dirty, setSegs, load, setTitle, markSaved } = useSubs();
  const [bom, setBom] = useState(false);
  const [shiftMs, setShiftMs] = useState("0");
  const [find, setFind] = useState("");
  const [repl, setRepl] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [saving, setSaving] = useState(false);
  const [audio, setAudio] = useState<{ media: string; url: string; label: string } | null>(null);
  const [playing, setPlaying] = useState(-1);
  const audioEl = useRef<HTMLAudioElement>(null);
  const areas = useRef<Record<number, HTMLTextAreaElement | null>>({});

  useEffect(() => {
    const url = audio?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [audio?.url]);
  useEffect(() => {
    const media = audio?.media;
    return () => {
      if (media) void api.discardMedia(media).catch(() => undefined);
    };
  }, [audio?.media]);

  const problems = new Set(findProblems(segs));
  const err = (e: unknown) => toast.error(errorText(e));

  const openFile = async () => {
    try {
      const f = await api.importFile("Subtitles", ["srt", "vtt", "txt"]);
      if (!f) return;
      const bytes = Uint8Array.from(atob(f.dataB64), (c) => c.charCodeAt(0));
      const parsed = parseSubtitles(new TextDecoder("utf-8").decode(bytes));
      if (parsed.length === 0) {
        toast.error(t("subs.noCues"));
        return;
      }
      load(parsed, f.name.replace(/\.[^.]+$/, ""));
    } catch (e) {
      err(e);
    }
  };

  const openAudio = async () => {
    try {
      const f = await api.importFile("Audio", ["mp3", "wav", "m4a", "ogg", "flac", "aac"]);
      if (!f) return;
      const media = await api.saveMedia(f.name.split(".").pop() ?? "mp3", f.dataB64);
      setAudio({ media, url: await audioUrl(media), label: f.name });
    } catch (e) {
      err(e);
    }
  };

  const doExport = (ext: "srt" | "vtt" | "txt") => {
    const body = ext === "srt" ? formatSrt(segs) : ext === "vtt" ? formatVtt(segs) : formatTxt(segs);
    exportPlain(body, title || "subtitles", ext, bom && ext !== "vtt" ? true : false)
      .then((p) => p && toast.success(t("content.exported", { path: p })))
      .catch(err);
  };

  const patch = (i: number, p: Partial<(typeof segs)[number]>) => setSegs(segs.map((s, k) => (k === i ? { ...s, ...p } : s)));
  const commitTime = (i: number, field: "start" | "end", raw: string) => {
    const v = parseTime(raw);
    if (v === null) {
      toast.error(t("subs.badTime"));
      setSegs([...segs]); // force the field to show the stored value again
      return;
    }
    patch(i, { [field]: v });
  };

  const seek = (ms: number) => {
    const el = audioEl.current;
    if (el) {
      el.currentTime = ms / 1000;
      void el.play().catch(() => undefined);
    }
  };

  if (segs.length === 0) {
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <div className="text-sm font-medium">{t("subs.empty")}</div>
        <p className="mt-1 text-xs text-muted-foreground">{t("subs.emptyHint")}</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="primary" onClick={() => void openFile()}>
            <FileUp className="size-4" aria-hidden />
            {t("subs.open")}
          </Button>
          <Button onClick={() => setSegs([{ start: 0, end: 2000, text: "" }])}>
            <Plus className="size-4" aria-hidden />
            {t("subs.startBlank")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input className="max-w-xs" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("subs.titlePlaceholder")} aria-label={t("subs.titlePlaceholder")} />
          <Button size="sm" onClick={() => void openFile()}>
            <FileUp className="size-3.5" aria-hidden />
            {t("subs.open")}
          </Button>
          <Button size="sm" onClick={() => void openAudio()}>
            <Music className="size-3.5" aria-hidden />
            {t("subs.loadAudio")}
          </Button>
          <Button size="sm" onClick={() => setSaving(true)}>
            <FolderPlus className="size-3.5" aria-hidden />
            {t("content.saveTitle")}
          </Button>
          <span className="flex-1" />
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={bom} onChange={(e) => setBom(e.target.checked)} />
            {t("subs.bom")}
          </label>
          {(["srt", "vtt", "txt"] as const).map((x) => (
            <Button key={x} size="sm" onClick={() => doExport(x)}>
              <Download className="size-3.5" aria-hidden />
              {x.toUpperCase()}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("subs.shift")} className="w-36">
            <Input value={shiftMs} onChange={(e) => setShiftMs(e.target.value)} inputMode="numeric" />
          </Field>
          <Button
            size="sm"
            onClick={() => {
              const n = Number(shiftMs);
              if (!Number.isFinite(n) || n === 0) return;
              setSegs(shiftAll(segs, n));
            }}
          >
            {t("subs.applyShift")}
          </Button>
          <Field label={t("subs.find")} className="w-40">
            <Input value={find} onChange={(e) => setFind(e.target.value)} />
          </Field>
          <Field label={t("subs.replaceWith")} className="w-40">
            <Input value={repl} onChange={(e) => setRepl(e.target.value)} />
          </Field>
          <label className="flex items-center gap-1 pb-2 text-xs">
            <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
            {t("subs.matchCase")}
          </label>
          <Button
            size="sm"
            disabled={!find}
            onClick={() => {
              const r = replaceAll(segs, find, repl, matchCase);
              if (r.count > 0) setSegs(r.segs);
              toast.info(t("subs.replaced", { count: r.count }));
            }}
          >
            {t("subs.replaceAll")}
          </Button>
        </div>
        {audio && <audio ref={audioEl} controls src={audio.url} className="w-full" onTimeUpdate={(e) => {
          const ms = e.currentTarget.currentTime * 1000;
          setPlaying(segs.findIndex((s) => ms >= s.start && ms < s.end));
        }} />}
        <p className="text-xs text-muted-foreground">
          {t("subs.count", { count: segs.length })}
          {problems.size > 0 && <span className="ms-3 text-amber-500">{t("subs.overlaps", { count: problems.size })}</span>}
          {dirty && <span className="ms-3">{t("subs.unsaved")}</span>}
          {assetId !== null && projectId !== null && <span className="ms-3">{t("subs.inProject")}</span>}
        </p>
      </div>

      <ol className="flex-1 space-y-2 overflow-y-auto p-4">
        {segs.map((s, i) => (
          <li key={i} className={cn("rounded-xl border bg-card p-3", playing === i && "border-primary", problems.has(i) && "border-amber-500/60")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-8 text-xs text-muted-foreground">{i + 1}</span>
              <Input
                key={`s${s.start}`}
                className="w-32 font-mono text-xs"
                defaultValue={formatTime(s.start, ",")}
                onBlur={(e) => commitTime(i, "start", e.target.value)}
                aria-label={t("subs.start")}
              />
              <span aria-hidden>→</span>
              <Input
                key={`e${s.end}`}
                className="w-32 font-mono text-xs"
                defaultValue={formatTime(s.end, ",")}
                onBlur={(e) => commitTime(i, "end", e.target.value)}
                aria-label={t("subs.end")}
              />
              <span className="flex-1" />
              {audio && (
                <Button size="sm" variant="ghost" onClick={() => seek(s.start)}>
                  {t("subs.play")}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSegs(splitSegment(segs, i, areas.current[i]?.selectionStart ?? Math.floor(s.text.length / 2)))}
                aria-label={t("subs.split")}
                title={t("subs.splitHint")}
              >
                <Scissors className="size-3.5" aria-hidden />
              </Button>
              <Button size="sm" variant="ghost" disabled={i === segs.length - 1} onClick={() => setSegs(mergeWithNext(segs, i))} aria-label={t("subs.merge")}>
                <Merge className="size-3.5" aria-hidden />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t("common.delete")}
                onClick={() => setSegs(segs.filter((_, k) => k !== i))}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </div>
            <Textarea
              ref={(el) => {
                areas.current[i] = el;
              }}
              className="mt-2"
              rows={2}
              value={s.text}
              onChange={(e) => patch(i, { text: e.target.value })}
            />
          </li>
        ))}
        <li>
          <Button
            size="sm"
            onClick={() => {
              const last = segs[segs.length - 1];
              const start = last ? last.end : 0;
              setSegs([...segs, { start, end: start + 2000, text: "" }]);
            }}
          >
            <Plus className="size-3.5" aria-hidden />
            {t("subs.add")}
          </Button>
        </li>
      </ol>

      {saving && (
        <SaveToProjectModal
          initialTitle={title}
          initialProjectId={projectId}
          onClose={() => setSaving(false)}
          onSave={async (target) => {
            const a = await api.saveAsset({
              id: assetId ?? undefined,
              projectId: target.projectId,
              kind: "subtitle",
              title: target.title || null,
              body: formatSrt(segs),
              lang,
              metaJson: null,
            });
            markSaved(a.id, target.projectId, target.title);
          }}
        />
      )}
    </div>
  );
}
