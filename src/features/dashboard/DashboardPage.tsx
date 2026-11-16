import { useTranslation } from "react-i18next";
import { AudioLines, Captions, Copy, Image, Mic, PenLine, type LucideIcon } from "lucide-react";
import { useUi } from "../../stores/ui";
import type { RouteId } from "../../app/nav";

const ACTIONS: ReadonlyArray<{ key: string; icon: LucideIcon; route: RouteId }> = [
  { key: "content", icon: PenLine, route: "content" },
  { key: "thumbnail", icon: Image, route: "thumbnail" },
  { key: "voice", icon: Mic, route: "voice" },
  { key: "clone", icon: Copy, route: "voice" },
  { key: "transcribe", icon: AudioLines, route: "audio" },
  { key: "subtitles", icon: Captions, route: "subtitles" },
];

export default function DashboardPage() {
  const { t } = useTranslation();
  const setRoute = useUi((s) => s.setRoute);

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
    </div>
  );
}
