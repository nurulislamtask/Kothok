import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, keyFrom, sharableCategories, type Category } from "../lib/api";
import { errorText } from "../lib/errors";
import { useProviders } from "../stores/providers";
import { toast } from "../stores/toast";
import { useUi } from "../stores/ui";
import { Button } from "./ui/controls";

/**
 * Shown on a page whose job has no provider yet. If a key you already added can do this job it
 * is offered with one click, so the same key never has to be typed twice.
 */
export default function NeedProvider({ category, title, body }: { category: Category; title: string; body: string }) {
  const { t } = useTranslation();
  const setRoute = useUi((s) => s.setRoute);
  const providers = useProviders((s) => s.providers);
  const refresh = useProviders((s) => s.refresh);
  const [busy, setBusy] = useState<string | null>(null);

  const owners = providers.filter(
    (p) => p.hasKey && !keyFrom(p) && p.category !== category && sharableCategories(p).includes(category),
  );

  const use = async (id: string) => {
    setBusy(id);
    try {
      await api.linkProvider(id, category);
      await refresh();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-amber-500/40 bg-amber-500/10 p-6 text-sm">
      <div className="font-medium">{title}</div>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
      {owners.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="text-xs font-medium">{t("need.useExisting")}</div>
          {owners.map((o) => (
            <Button key={o.id} variant="primary" size="sm" className="me-2" disabled={busy !== null} onClick={() => void use(o.id)}>
              {t("need.useKey", { name: o.displayName })}
            </Button>
          ))}
          {category === "image" && <p className="text-xs text-amber-500">{t("need.imagePaid")}</p>}
        </div>
      )}
      <Button className="mt-4" size="sm" onClick={() => setRoute("apiManager")}>
        {t("content.goApi")}
      </Button>
    </div>
  );
}
