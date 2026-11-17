import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AudioLines, Captions, Copy, Image, Mic, PenLine, type LucideIcon } from "lucide-react";
import { api, type Asset, type Project } from "../../lib/api";
import { isTauri } from "../../lib/ipc";
import { formatDate } from "../../lib/utils";
import { useContent } from "../../stores/content";
import { useProviders } from "../../stores/providers";
import { useUi } from "../../stores/ui";
import type { RouteId } from "../../app/nav";
import { Badge, Button } from "../../components/ui/controls";

const ACTIONS: ReadonlyArray<{ key: string; icon: LucideIcon; route: RouteId }> = [
  { key: "content", icon: PenLine, route: "content" },
  { key: "thumbnail", icon: Image, route: "thumbnail" },
  { key: "voice", icon: Mic, route: "voice" },
  { key: "clone", icon: Copy, route: "voice" },
  { key: "transcribe", icon: AudioLines, route: "audio" },
  { key: "subtitles", icon: Captions, route: "subtitles" },
];

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function DashboardPage() {
  const { t, i18n } = useTranslation();
  const setRoute = useUi((s) => s.setRoute);
  const providers = useProviders((s) => s.providers);
  const defaults = useProviders((s) => s.defaults);
  const [projects, setProjects] = useState<Project[]>([]);
  const [content, setContent] = useState<Asset[]>([]);

  useEffect(() => {
    if (!isTauri()) return;
    api.listProjects().then((p) => setProjects(p.slice(0, 5))).catch(() => undefined);
    api.listAssets(null, "content", 5).then(setContent).catch(() => undefined);
  }, []);

  const defaultId = defaults.find((d) => d.category === "text")?.providerId;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-8">
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">{t("dashboard.welcome")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("dashboard.subtitle")}</p>
      </section>

      <section aria-labelledby="quick-actions">
        <h3 id="quick-actions" className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard.quickActions")}
        </h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {ACTIONS.map(({ key, icon: Icon, route }) => (
            <button
              key={key}
              type="button"
              onClick={() => setRoute(route)}
              className="group flex items-center gap-3 rounded-xl border bg-card p-4 text-start transition-colors hover:border-primary/50"
            >
              <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-primary">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="text-sm font-medium">{t(`dashboard.actions.${key}`)}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title={t("dashboard.apiStatus")}
          action={
            <Button size="sm" variant="ghost" onClick={() => setRoute("apiManager")}>
              {t("dashboard.manage")}
            </Button>
          }
        >
          {providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("dashboard.noProviders")}</p>
          ) : (
            <ul className="space-y-2">
              {providers.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  <span
                    className={`size-2 rounded-full ${p.lastStatus === "ok" ? "bg-emerald-500" : p.lastStatus === "error" ? "bg-red-500" : "bg-muted-foreground/40"}`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{p.displayName}</span>
                  {p.id === defaultId && <Badge tone="ok">{t("api.isDefault")}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t("dashboard.recentProjects")}>
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("dashboard.nothingYet")}</p>
          ) : (
            <ul className="space-y-2">
              {projects.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setRoute("projects")} className="w-full text-start">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(p.updatedAt, i18n.language)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t("dashboard.recentContent")}>
          {content.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("dashboard.nothingYet")}</p>
          ) : (
            <ul className="space-y-2">
              {content.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => {
                      useContent.getState().loadAsset(a);
                      setRoute("content");
                    }}
                    className="w-full text-start"
                  >
                    <div className="truncate text-sm font-medium">{a.title || t("projects.untitled")}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(a.createdAt, i18n.language)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
