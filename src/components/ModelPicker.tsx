import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { api, savedModel, type ModelInfo, type Provider } from "../lib/api";
import { errorText } from "../lib/errors";
import { useProviders } from "../stores/providers";
import { toast } from "../stores/toast";
import { Button, Input, Select } from "./ui/controls";

const cache = new Map<string, ModelInfo[]>();

/**
 * Model chooser for one provider. The list is synced from the provider itself (filtered to the
 * provider's job), and picking a model saves it for that provider, so each page keeps its own.
 */
export default function ModelPicker({
  provider,
  value,
  onChange,
}: {
  provider: Provider | undefined;
  /** A per-run override; empty means "use the provider's saved model". */
  value: string;
  onChange: (model: string) => void;
}) {
  const { t } = useTranslation();
  const refreshProviders = useProviders((s) => s.refresh);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const id = provider?.id;

  const load = useCallback(
    async (force: boolean) => {
      if (!id) return;
      if (!force && cache.has(id)) {
        setModels(cache.get(id) ?? []);
        setFailed(false);
        return;
      }
      setLoading(true);
      try {
        const list = await api.listProviderModels(id);
        cache.set(id, list);
        setModels(list);
        setFailed(list.length === 0);
      } catch (e) {
        setModels([]);
        setFailed(true);
        if (force) toast.error(errorText(e));
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    setModels([]);
    void load(false);
  }, [load]);

  if (!provider) return null;
  const current = value || savedModel(provider);

  const pick = async (m: string) => {
    onChange(m);
    if (!m.trim() || m === savedModel(provider)) return;
    try {
      await api.setProviderModel(provider.id, m);
      await refreshProviders();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const options = models.some((m) => m.id === current) || !current ? models : [{ id: current, displayName: null }, ...models];

  const notListed = models.length > 0 && !!current && !models.some((m) => m.id === current);

  return (
    <div>
    <div className="flex gap-2">
      {models.length > 0 ? (
        <Select value={current} onChange={(e) => void pick(e.target.value)} aria-label={t("content.model")}>
          {!current && <option value="">{t("model.choose")}</option>}
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName && m.displayName !== m.id ? `${m.displayName} (${m.id})` : m.id}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          defaultValue={current}
          key={provider.id}
          placeholder={loading ? t("common.loading") : failed ? t("model.typeIt") : t("content.modelPlaceholder")}
          onBlur={(e) => void pick(e.target.value.trim())}
          aria-label={t("content.model")}
        />
      )}
      <Button size="sm" onClick={() => void load(true)} disabled={loading} aria-label={t("model.sync")} title={t("model.sync")}>
        <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />
      </Button>
    </div>
    {notListed && <p className="mt-1 text-xs text-amber-500">{t("model.notListed")}</p>}
    </div>
  );
}
