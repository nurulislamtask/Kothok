import { useTranslation } from "react-i18next";
import { AudioLines } from "lucide-react";
import { cn } from "../lib/utils";
import { useUi } from "../stores/ui";
import { NAV, NAV_GROUPS } from "./nav";

export default function Sidebar() {
  const { t } = useTranslation();
  const route = useUi((s) => s.route);
  const setRoute = useUi((s) => s.setRoute);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r bg-sidebar">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <AudioLines className="size-4" aria-hidden />
        </div>
        <span className="text-base font-semibold tracking-tight">{t("app.name")}</span>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2" aria-label="Main">
        {NAV_GROUPS.map((g) => (
          <div key={g.id} className="pb-2">
            {g.id !== "start" && (
              <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {t(`nav.group.${g.id}`)}
              </div>
            )}
            {g.items.map((id) => {
              const Icon = NAV.find((n) => n.id === id)?.icon;
              if (!Icon) return null;
              const active = id === route;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setRoute(id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className={cn("size-4", active && "text-primary")} aria-hidden />
                  <span className="truncate">{t(`nav.${id}`)}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
