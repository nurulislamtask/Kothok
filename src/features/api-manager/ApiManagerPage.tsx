import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Plus, Star, Trash2, X, Zap } from "lucide-react";
import {
  api,
  savedModel,
  type Category,
  type CostClass,
  type ModelInfo,
  type Provider,
  type ProviderInput,
} from "../../lib/api";
import { errorText } from "../../lib/errors";
import { toast } from "../../stores/toast";
import { useProviders } from "../../stores/providers";
import { Badge, Button, ConfirmModal, Field, Input, Modal, Select } from "../../components/ui/controls";
import { CATEGORIES, COST_CLASSES, PRESETS } from "./presets";

function isLocalEndpoint(p: Provider): boolean {
  const e = p.endpoint ?? "";
  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(e);
}

function costTone(c: CostClass): "ok" | "warn" | "muted" {
  if (c === "paid") return "warn";
  if (c === "local" || c === "free") return "ok";
  return "muted";
}

function ProviderForm({ existing, onClose }: { existing?: Provider; onClose: () => void }) {
  const { t } = useTranslation();
  const refresh = useProviders((s) => s.refresh);
  const [category, setCategory] = useState<Category>(existing?.category ?? "text");
  const first = PRESETS.find((p) => p.category === (existing?.category ?? "text"));
  const [presetId, setPresetId] = useState(existing ? "" : (first?.id ?? "gemini"));
  const [name, setName] = useState(existing?.displayName ?? (first ? t(`api.presets.${first.id}.name`) : ""));
  const [adapter, setAdapter] = useState<string>(existing?.adapter ?? first?.adapter ?? "gemini");
  const [endpoint, setEndpoint] = useState(existing?.endpoint ?? first?.endpoint ?? "");
  const [costClass, setCostClass] = useState<CostClass>(existing?.costClass ?? first?.costClass ?? "paid");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  const applyPreset = (id: string) => {
    setPresetId(id);
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setName(t(`api.presets.${p.id}.name`));
    setAdapter(p.adapter);
    setEndpoint(p.endpoint);
    setCostClass(p.costClass);
  };

  const changeCategory = (c: Category) => {
    setCategory(c);
    const p = PRESETS.find((x) => x.category === c);
    if (p) applyPreset(p.id);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const input: ProviderInput = {
        id: existing?.id,
        category,
        adapter,
        displayName: name,
        endpoint: endpoint.trim() || null,
        enabled: existing?.enabled ?? true,
        costClass,
        settingsJson: existing?.settingsJson ?? null,
        apiKey: apiKey.trim() || undefined,
      };
      await api.saveProvider(input);
      await refresh();
      toast.success(t("api.saved"));
      onClose();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const preset = PRESETS.find((p) => p.id === presetId);

  return (
    <Modal
      title={existing ? t("api.editTitle") : t("api.addTitle")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void submit()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      {!existing && (
        <Field label={t("api.category")}>
          <Select value={category} onChange={(e) => changeCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`api.categories.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {!existing && (
        <Field label={t("api.preset")} hint={preset ? t(`api.presets.${preset.id}.note`) : undefined}>
          <Select value={presetId} onChange={(e) => applyPreset(e.target.value)}>
            {PRESETS.filter((p) => p.category === category).map((p) => (
              <option key={p.id} value={p.id}>
                {t(`api.presets.${p.id}.name`)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t("api.name")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {adapter !== "gemini" && adapter !== "gemini_image" && (
        <Field label={t("api.endpoint")} hint={t("api.endpointHint")}>
          <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://…/v1" />
        </Field>
      )}
      <Field label={t("api.cost")}>
        <Select value={costClass} onChange={(e) => setCostClass(e.target.value as CostClass)}>
          {COST_CLASSES.map((c) => (
            <option key={c} value={c}>
              {t(`api.costs.${c}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label={t("api.apiKey")}
        hint={existing?.hasKey ? t("api.apiKeyKeep") : costClass === "local" ? t("api.apiKeyOptional") : t("api.apiKeyStored")}
      >
        <Input
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={t("api.apiKeyPlaceholder")}
        />
      </Field>
    </Modal>
  );
}

function ProviderCard({ p, isDefault }: { p: Provider; isDefault: boolean }) {
  const { t } = useTranslation();
  const refresh = useProviders((s) => s.refresh);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState(savedModel(p));
  const [testing, setTesting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const toInput = (over: Partial<ProviderInput>): ProviderInput => ({
    id: p.id,
    category: p.category,
    adapter: p.adapter,
    displayName: p.displayName,
    endpoint: p.endpoint,
    enabled: p.enabled,
    costClass: p.costClass,
    settingsJson: p.settingsJson,
    ...over,
  });

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const test = () =>
    run(async () => {
      setTesting(true);
      try {
        const r = await api.testProvider(p.id);
        if (r.ok) {
          setModels(r.models);
          toast.success(t("api.testOk", { count: r.models.length }));
        } else {
          toast.error(t(`errors.${r.errorCode ?? "unknown"}`, { defaultValue: t("errors.unknown") }));
        }
        await refresh();
      } finally {
        setTesting(false);
      }
    });

  const saveModel = () =>
    run(async () => {
      let settings: Record<string, unknown> = {};
      try {
        settings = p.settingsJson ? (JSON.parse(p.settingsJson) as Record<string, unknown>) : {};
      } catch {
        settings = {};
      }
      settings["model"] = model.trim();
      await api.saveProvider(toInput({ settingsJson: JSON.stringify(settings) }));
      // The default row caches the model, so refresh it when this is the default provider.
      if (isDefault) await api.setDefault(p.category, p.id);
      await refresh();
      toast.success(t("api.modelSaved"));
    });

  const status = p.lastStatus === "ok" ? "ok" : p.lastStatus === "error" ? "bad" : "muted";
  const lastCode = p.lastError?.split(":")[0] ?? "";

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`size-2 rounded-full ${status === "ok" ? "bg-emerald-500" : status === "bad" ? "bg-red-500" : "bg-muted-foreground/40"}`}
          aria-hidden
        />
        <h3 className="text-sm font-semibold">{p.displayName}</h3>
        {isDefault && <Badge tone="ok">{t("api.isDefault")}</Badge>}
        <Badge tone={costTone(p.costClass)}>{t(`api.costs.${p.costClass}`)}</Badge>
        <Badge>{isLocalEndpoint(p) ? t("api.local") : t("api.cloud")}</Badge>
        <Badge tone={p.hasKey ? "ok" : "muted"}>{p.hasKey ? t("api.hasKey") : t("api.noKey")}</Badge>
        {!p.enabled && <Badge tone="warn">{t("api.disabled")}</Badge>}
        <div className="ms-auto flex items-center gap-1.5">
          <Button size="sm" disabled={testing} onClick={() => void test()}>
            <Zap className="size-3.5" aria-hidden />
            {testing ? t("api.testing") : t("api.test")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {t("common.edit")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} aria-label={t("common.delete")}>
            <Trash2 className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      {p.lastStatus === "error" && (
        <p className="mt-2 text-xs text-red-500">
          {t(`errors.${lastCode}`, { defaultValue: t("errors.unknown") })}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label={t("api.model")} className="min-w-64 flex-1">
          <Input
            list={`models-${p.id}`}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={t("api.modelPlaceholder")}
          />
          <datalist id={`models-${p.id}`}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName ?? m.id}
              </option>
            ))}
          </datalist>
        </Field>
        <Button disabled={!model.trim() || model.trim() === savedModel(p)} onClick={() => void saveModel()}>
          {t("api.saveModel")}
        </Button>
        <Button
          variant={isDefault ? "ghost" : "secondary"}
          disabled={isDefault || !savedModel(p)}
          title={!savedModel(p) ? t("api.defaultNeedsModel") : undefined}
          onClick={() =>
            void run(async () => {
              await api.setDefault(p.category, p.id);
              await refresh();
              toast.success(t("api.defaultSet"));
            })
          }
        >
          <Star className="size-3.5" aria-hidden />
          {t("api.makeDefault")}
        </Button>
        <label className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={p.enabled}
            onChange={(e) =>
              void run(async () => {
                await api.saveProvider(toInput({ enabled: e.target.checked }));
                await refresh();
              })
            }
          />
          {t("api.enabled")}
        </label>
        {p.hasKey && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void run(async () => {
                await api.clearApiKey(p.id);
                await refresh();
                toast.success(t("api.keyRemoved"));
              })
            }
          >
            <X className="size-3.5" aria-hidden />
            {t("api.removeKey")}
          </Button>
        )}
      </div>

      {editing && <ProviderForm existing={p} onClose={() => setEditing(false)} />}
      {confirmDelete && (
        <ConfirmModal
          danger
          title={t("api.deleteTitle")}
          body={t("api.deleteBody", { name: p.displayName })}
          confirmLabel={t("common.delete")}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void run(async () => {
              await api.deleteProvider(p.id);
              await refresh();
              toast.success(t("api.deleted"));
            });
          }}
        />
      )}
    </div>
  );
}

function FallbackSection({ providers }: { providers: Provider[] }) {
  const { t } = useTranslation();
  const chains = useProviders((s) => s.chains);
  const refresh = useProviders((s) => s.refresh);
  const saved = chains.filter((c) => c.category === "text").map((c) => c.providerId);
  const [ids, setIds] = useState<string[]>(saved);
  const [adding, setAdding] = useState("");

  useEffect(() => {
    setIds(chains.filter((c) => c.category === "text").map((c) => c.providerId));
  }, [chains]);

  const byId = (id: string) => providers.find((p) => p.id === id);
  const candidates = providers.filter((p) => !ids.includes(p.id));
  const dirty = ids.join("|") !== saved.join("|");
  const hasPaid = ids.some((id) => byId(id)?.costClass === "paid");

  const move = (i: number, d: -1 | 1) => {
    const next = [...ids];
    const j = i + d;
    const a = next[i];
    const b = next[j];
    if (a === undefined || b === undefined) return;
    next[i] = b;
    next[j] = a;
    setIds(next);
  };

  const save = async () => {
    try {
      await api.setFallbackChain(
        "text",
        ids.map((providerId) => ({ providerId, model: null })),
      );
      await refresh();
      toast.success(t("api.fallbackSaved"));
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  return (
    <section className="mt-8">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("api.fallbackTitle")}</h3>
      <div className="mt-2 space-y-3 rounded-xl border bg-card p-4">
        <p className="text-xs text-muted-foreground">{t("api.fallbackHint")}</p>
        {ids.length === 0 && <p className="text-sm text-muted-foreground">{t("api.fallbackEmpty")}</p>}
        <ol className="space-y-1.5">
          {ids.map((id, i) => {
            const p = byId(id);
            return (
              <li key={id} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <span className="w-5 text-xs text-muted-foreground">{i + 1}</span>
                <span className="flex-1">{p?.displayName ?? id}</span>
                {p && <Badge tone={costTone(p.costClass)}>{t(`api.costs.${p.costClass}`)}</Badge>}
                <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("api.moveUp")}>
                  <ArrowUp className="size-3.5" aria-hidden />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={i === ids.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={t("api.moveDown")}
                >
                  <ArrowDown className="size-3.5" aria-hidden />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setIds(ids.filter((x) => x !== id))} aria-label={t("common.remove")}>
                  <X className="size-3.5" aria-hidden />
                </Button>
              </li>
            );
          })}
        </ol>
        <div className="flex items-center gap-2">
          <Select value={adding} onChange={(e) => setAdding(e.target.value)} className="max-w-xs">
            <option value="">{t("api.fallbackAdd")}</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </Select>
          <Button
            disabled={!adding}
            onClick={() => {
              setIds([...ids, adding]);
              setAdding("");
            }}
          >
            <Plus className="size-3.5" aria-hidden />
            {t("common.add")}
          </Button>
          <Button variant="primary" className="ms-auto" disabled={!dirty} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </div>
        {hasPaid && <p className="text-xs text-amber-500">{t("api.fallbackPaidNote")}</p>}
      </div>
    </section>
  );
}

export default function ApiManagerPage() {
  const { t } = useTranslation();
  const providers = useProviders((s) => s.providers);
  const defaults = useProviders((s) => s.defaults);
  const loaded = useProviders((s) => s.loaded);
  const refresh = useProviders((s) => s.refresh);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const text = providers.filter((p) => p.category === "text");

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{t("api.title")}</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t("api.subtitle")}</p>
        </div>
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden />
          {t("api.add")}
        </Button>
      </div>

      <p className="mt-4 rounded-lg border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">{t("api.scopeNote")}</p>

      {loaded && providers.length === 0 && (
        <div className="mt-6 rounded-xl border border-dashed p-8 text-center">
          <div className="text-sm font-medium">{t("api.empty")}</div>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">{t("api.emptyHint")}</p>
        </div>
      )}

      {CATEGORIES.map((cat) => {
        const list = providers.filter((p) => p.category === cat);
        if (list.length === 0) return null;
        const defaultId = defaults.find((d) => d.category === cat)?.providerId ?? null;
        return (
          <section key={cat} className="mt-6 space-y-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`api.categories.${cat}`)}</h3>
            {list.map((p) => (
              <ProviderCard key={p.id} p={p} isDefault={p.id === defaultId} />
            ))}
          </section>
        );
      })}

      {text.length > 1 && <FallbackSection providers={text} />}

      {adding && <ProviderForm onClose={() => setAdding(false)} />}
    </div>
  );
}
