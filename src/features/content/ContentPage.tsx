import ModelPicker from "../../components/ModelPicker";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Download,
  FastForward,
  FilePlus,
  Languages,
  Maximize2,
  Minimize2,
  RefreshCw,
  Save,
  Sparkles,
  SpellCheck,
  Square,
  Undo2,
  Wand2,
  Copy,
  KeyRound,
  Mic,
  Image as ImageIcon,
} from "lucide-react";
import { api, isReady } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { exportText, type TextFormat } from "../../lib/exporters";
import { cn } from "../../lib/utils";
import { useContent } from "../../stores/content";
import { useProviders, defaultProvider } from "../../stores/providers";
import { toast } from "../../stores/toast";
import { useUi } from "../../stores/ui";
import { useVoice } from "../../stores/voice";
import SaveToProjectModal from "../../components/SaveToProjectModal";
import { Button, ConfirmModal, Field, Input, Select, Textarea } from "../../components/ui/controls";
import {
  CONTENT_TYPES,
  LENGTHS,
  PLATFORMS,
  STYLES,
  TONES,
  countWords,
  type Op,
  type OutLang,
} from "./prompts";

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "flex-1 rounded-md px-2 py-1.5 text-xs transition-colors",
            value === o.value ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ContentSaveModal({ onClose }: { onClose: () => void }) {
  const st = useContent.getState();
  const initialTitle = st.title || st.body.trim().split(/\r?\n/)[0]?.slice(0, 60) || "";
  return (
    <SaveToProjectModal
      initialTitle={initialTitle}
      initialProjectId={st.projectId}
      onClose={onClose}
      onSave={async ({ projectId, title }) => {
        const cur = useContent.getState();
        const meta = JSON.stringify({
          contentType: cur.settings.contentType,
          tone: cur.settings.tone,
          style: cur.settings.style,
          length: cur.settings.length,
          platform: cur.settings.platform,
          provider: cur.note?.provider ?? null,
          model: cur.note?.model ?? null,
        });
        const asset = await api.saveAsset({
          id: cur.assetId ?? undefined,
          projectId,
          kind: "content",
          title: title || null,
          body: cur.body,
          lang: cur.settings.lang,
          metaJson: meta,
        });
        cur.markSaved(asset.id, asset.projectId, title);
      }}
    />
  );
}

export default function ContentPage() {
  const { t } = useTranslation();
  const setRoute = useUi((s) => s.setRoute);
  const providers = useProviders((s) => s.providers);
  const defaults = useProviders((s) => s.defaults);

  const settings = useContent((s) => s.settings);
  const title = useContent((s) => s.title);
  const body = useContent((s) => s.body);
  const assetId = useContent((s) => s.assetId);
  const dirty = useContent((s) => s.dirty);
  const historyLen = useContent((s) => s.history.length);
  const lastGenerated = useContent((s) => s.lastGenerated);
  const note = useContent((s) => s.note);
  const patch = useContent((s) => s.patchSettings);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const live = useContent((s) => s.live);
  const paid = useContent((s) => s.paid);
  const busyOp = live?.op ?? null;
  const [targetLang, setTargetLang] = useState<"bn" | "en">("en");
  const [saveOpen, setSaveOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const ready = useMemo(() => providers.filter((p) => p.category === "text" && isReady(p)), [providers]);
  const effective = useMemo(
    () =>
      ready.find((p) => p.id === settings.providerId) ??
      defaultProvider({ providers, defaults }, "text") ??
      ready[0],
    [ready, settings.providerId, providers, defaults],
  );

  // Autosave once a document has been saved to a project.
  useEffect(() => {
    if (assetId === null || !dirty) return;
    const handle = setTimeout(() => {
      const cur = useContent.getState();
      if (cur.assetId === null) return;
      api
        .saveAsset({
          id: cur.assetId,
          projectId: cur.projectId,
          kind: "content",
          title: cur.title.trim() || null,
          body: cur.body,
          lang: cur.settings.lang,
          metaJson: null,
        })
        .then((a) => cur.markSaved(a.id, a.projectId, cur.title))
        .catch((e: unknown) => console.error("Autosave failed", e));
    }, 2000);
    return () => clearTimeout(handle);
  }, [assetId, dirty, body, title]);

  const run = (op: Op) => {
    const ta = taRef.current;
    void useContent.getState().run({
      op,
      providerId: effective?.id,
      targetLang,
      start: ta?.selectionStart ?? 0,
      end: ta?.selectionEnd ?? 0,
    });
  };

  const copy = async () => {
    const ta = taRef.current;
    const sel = ta && ta.selectionEnd > ta.selectionStart ? body.slice(ta.selectionStart, ta.selectionEnd) : "";
    try {
      await navigator.clipboard.writeText(sel || body);
      toast.success(t("common.copied"));
    } catch {
      toast.error(t("errors.unknown"));
    }
  };

  const doExport = async (format: TextFormat) => {
    setExportOpen(false);
    try {
      const path = await exportText(body, title || t("content.titlePlaceholder"), format);
      if (path) toast.success(t("content.exported", { path }));
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const busy = busyOp !== null;
  const hasText = body.trim().length > 0;
  const paidName = providers.find((p) => p.id === paid?.providerId)?.displayName ?? paid?.providerId ?? "";

  const aiBtn = (op: Op, icon: ReactNode, label: string) => (
    <Button size="sm" disabled={busy || !hasText || !effective} onClick={() => run(op)}>
      {icon}
      {label}
    </Button>
  );

  return (
    <div className="flex h-full">
      <aside className="w-80 shrink-0 space-y-4 overflow-y-auto border-e p-4">
        <Field label={t("content.topic")}>
          <Textarea
            rows={4}
            value={settings.topic}
            onChange={(e) => patch({ topic: e.target.value })}
            placeholder={t("content.topicPlaceholder")}
          />
        </Field>
        <Button
          variant="primary"
          className="w-full"
          disabled={busy || !effective}
          onClick={() => run("generate")}
        >
          <Sparkles className="size-4" aria-hidden />
          {busyOp === "generate" ? t("content.generating") : t("content.ops.generate")}
        </Button>

        <Field label={t("content.contentType")}>
          <Select value={settings.contentType} onChange={(e) => patch({ contentType: e.target.value })}>
            {CONTENT_TYPES.map((c) => (
              <option key={c} value={c}>
                {t(`content.types.${c}`)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t("content.language")}>
          <Segmented<OutLang>
            value={settings.lang}
            onChange={(lang) => patch({ lang })}
            options={[
              { value: "bn", label: "বাংলা" },
              { value: "en", label: "English" },
              { value: "mixed", label: t("content.mixed") },
            ]}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("content.tone")}>
            <Select value={settings.tone} onChange={(e) => patch({ tone: e.target.value })}>
              {TONES.map((x) => (
                <option key={x} value={x}>
                  {t(`content.tones.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("content.style")}>
            <Select value={settings.style} onChange={(e) => patch({ style: e.target.value })}>
              {STYLES.map((x) => (
                <option key={x} value={x}>
                  {t(`content.styles.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label={t("content.length")}>
          <Segmented
            value={settings.length}
            onChange={(length) => patch({ length })}
            options={LENGTHS.map((l) => ({ value: l, label: t(`content.lengths.${l}`) }))}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("content.platform")}>
            <Select value={settings.platform} onChange={(e) => patch({ platform: e.target.value })}>
              {PLATFORMS.map((x) => (
                <option key={x} value={x}>
                  {t(`content.platforms.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("content.audience")}>
            <Input
              value={settings.audience}
              onChange={(e) => patch({ audience: e.target.value })}
              placeholder={t("content.audiencePlaceholder")}
            />
          </Field>
        </div>

        <Field label={t("content.instructions")}>
          <Textarea rows={3} value={settings.instructions} onChange={(e) => patch({ instructions: e.target.value })} />
        </Field>

        <div className="space-y-3 border-t pt-4">
          <Field label={t("content.provider")}>
            <Select
              value={effective?.id ?? ""}
              onChange={(e) => patch({ providerId: e.target.value, model: "" })}
              disabled={ready.length === 0}
            >
              {ready.length === 0 && <option value="">{t("content.noProviderShort")}</option>}
              {ready.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("content.model")}>
            <ModelPicker provider={effective} value={settings.model} onChange={(m) => patch({ model: m })} />
          </Field>
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={settings.allowFallback}
              onChange={(e) => patch({ allowFallback: e.target.checked })}
              className="mt-0.5"
            />
            {t("content.fallback")}
          </label>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {ready.length === 0 && (
          <div className="flex items-center justify-between gap-4 border-b bg-amber-500/10 px-5 py-3 text-sm">
            <div>
              <div className="font-medium">{t("content.noProviderTitle")}</div>
              <div className="text-xs text-muted-foreground">{t("content.noProviderBody")}</div>
            </div>
            <Button size="sm" variant="primary" onClick={() => setRoute("apiManager")}>
              <KeyRound className="size-3.5" aria-hidden />
              {t("content.goApi")}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
          {lastGenerated && (
            <Button size="sm" disabled={busy || !effective} onClick={() => run("generate")}>
              <RefreshCw className="size-3.5" aria-hidden />
              {t("content.ops.regenerate")}
            </Button>
          )}
          {aiBtn("continue", <FastForward className="size-3.5" aria-hidden />, t("content.ops.continue"))}
          {aiBtn("rewrite", <Wand2 className="size-3.5" aria-hidden />, t("content.ops.rewrite"))}
          {aiBtn("expand", <Maximize2 className="size-3.5" aria-hidden />, t("content.ops.expand"))}
          {aiBtn("shorten", <Minimize2 className="size-3.5" aria-hidden />, t("content.ops.shorten"))}
          {aiBtn("grammar", <SpellCheck className="size-3.5" aria-hidden />, t("content.ops.grammar"))}
          <div className="flex items-center gap-1">
            <Select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value === "bn" ? "bn" : "en")}
              className="h-8 w-24 text-xs"
              aria-label={t("content.translateTo")}
            >
              <option value="en">English</option>
              <option value="bn">বাংলা</option>
            </Select>
            {aiBtn("translate", <Languages className="size-3.5" aria-hidden />, t("content.ops.translate"))}
          </div>
          {busy && (
            <Button size="sm" variant="danger" onClick={() => useContent.getState().stop()}>
              <Square className="size-3.5" aria-hidden />
              {t("common.stop")}
            </Button>
          )}

          <div className="ms-auto flex items-center gap-1.5">
            <Button size="sm" variant="ghost" disabled={historyLen === 0} onClick={() => useContent.getState().undo()}>
              <Undo2 className="size-3.5" aria-hidden />
              {t("common.undo")}
            </Button>
            <Button size="sm" variant="ghost" disabled={!hasText} onClick={() => void copy()}>
              <Copy className="size-3.5" aria-hidden />
              {t("common.copy")}
            </Button>
            <Button size="sm" disabled={!hasText} onClick={() => setSaveOpen(true)}>
              <Save className="size-3.5" aria-hidden />
              {t("common.save")}
            </Button>
            <Button
              size="sm"
              disabled={!hasText}
              onClick={() => {
                useVoice.getState().setScript(body);
                setRoute("voice");
              }}
            >
              <Mic className="size-3.5" aria-hidden />
              {t("content.toVoice")}
            </Button>
            <Button size="sm" disabled={!hasText} onClick={() => setRoute("thumbnail")}>
              <ImageIcon className="size-3.5" aria-hidden />
              {t("content.toThumb")}
            </Button>
            <div className="relative">
              <Button size="sm" disabled={!hasText} onClick={() => setExportOpen((o) => !o)}>
                <Download className="size-3.5" aria-hidden />
                {t("content.export")}
              </Button>
              {exportOpen && (
                <div className="absolute end-0 top-9 z-10 w-36 overflow-hidden rounded-lg border bg-card p-1 shadow-lg">
                  {(["txt", "md", "docx"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => void doExport(f)}
                      className="w-full rounded-md px-3 py-2 text-start text-sm hover:bg-muted"
                    >
                      {t(`content.formats.${f}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button size="sm" variant="ghost" onClick={() => useContent.getState().reset()}>
              <FilePlus className="size-3.5" aria-hidden />
              {t("content.new")}
            </Button>
          </div>
        </div>

        <input
          value={title}
          onChange={(e) => useContent.getState().setTitle(e.target.value)}
          placeholder={t("content.titlePlaceholder")}
          aria-label={t("content.docTitle")}
          className="border-b bg-transparent px-6 py-3 text-lg font-semibold placeholder:text-muted-foreground"
        />
        {live && (
          <div className="border-b bg-primary/5 px-6 py-2 text-xs" role="status" aria-live="polite">
            <div className="flex flex-wrap items-center gap-2 font-medium text-primary">
              <span className="inline-block size-2 animate-pulse rounded-full bg-primary" aria-hidden />
              {t("content.liveTitle")}
              {live.provider && (
                <span className="font-normal text-muted-foreground">
                  {t("content.liveWith", { provider: live.provider, model: live.model })}
                </span>
              )}
              <span className="ms-auto font-normal text-muted-foreground">
                {live.text ? t("content.liveChars", { count: live.text.length }) : t("content.liveWaiting")}
              </span>
            </div>
            {live.op !== "generate" && live.op !== "continue" && live.text && (
              <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border bg-card p-2 font-sans text-[13px] leading-6">
                {live.text}
              </pre>
            )}
          </div>
        )}
        <textarea
          ref={taRef}
          readOnly={live !== null && (live.op === "generate" || live.op === "continue")}
          value={
            live?.op === "generate" ? live.text : live?.op === "continue" ? `${body.replace(/\s+$/, "")}\n\n${live.text}` : body
          }
          onChange={(e) => useContent.getState().setBody(e.target.value)}
          placeholder={t("content.editorPlaceholder")}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none bg-transparent px-6 py-4 text-[15px] leading-7 placeholder:text-muted-foreground"
        />

        <div className="flex items-center gap-4 border-t px-6 py-2 text-xs text-muted-foreground">
          <span>{t("content.words", { count: countWords(body) })}</span>
          <span>{t("content.chars", { count: body.length })}</span>
          {note && (
            <span className={note.kind === "fallback" ? "text-amber-500" : undefined}>
              {t(note.kind === "fallback" ? "content.usedFallback" : "content.usedProvider", {
                provider: note.provider,
                model: note.model,
              })}
            </span>
          )}
          <span className="ms-auto">
            {assetId !== null ? (dirty ? t("content.unsaved") : t("common.saved")) : ""}
          </span>
        </div>
      </section>

      {saveOpen && <ContentSaveModal onClose={() => setSaveOpen(false)} />}
      {paid && (
        <ConfirmModal
          title={t("content.confirmPaidTitle")}
          body={t("content.confirmPaidBody", { name: paidName })}
          confirmLabel={t("content.confirmPaidYes")}
          onClose={() => useContent.getState().clearPaid()}
          onConfirm={() => useContent.getState().confirmPaid()}
        />
      )}
    </div>
  );
}
