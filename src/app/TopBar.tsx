import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Moon, Search, Settings, Sun } from "lucide-react";
import { useUi } from "../stores/ui";
import { NAV } from "./nav";

export default function TopBar() {
  const { t } = useTranslation();
  const route = useUi((s) => s.route);
  const theme = useUi((s) => s.theme);
  const uiLang = useUi((s) => s.uiLang);
  const setRoute = useUi((s) => s.setRoute);
  const setTheme = useUi((s) => s.setTheme);
  const setUiLang = useUi((s) => s.setUiLang);
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const matches = needle ? NAV.filter((n) => t(`nav.${n.id}`).toLowerCase().includes(needle)) : [];

  const go = (id: (typeof NAV)[number]["id"]) => {
    setRoute(id);
    setQuery("");
  };

  const iconBtn =
    "flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b px-5">
      <h1 className="min-w-0 shrink-0 truncate text-sm font-semibold">{t(`nav.${route}`)}</h1>

      <div className="relative mx-auto w-full max-w-sm">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches[0]) go(matches[0].id);
            if (e.key === "Escape") setQuery("");
          }}
          placeholder={t("topbar.searchPlaceholder")}
          aria-label={t("topbar.searchPlaceholder")}
          className="h-9 w-full rounded-lg border bg-muted/40 ps-9 pe-3 text-sm placeholder:text-muted-foreground"
        />
        {needle && (
          <ul className="absolute inset-x-0 top-11 z-10 overflow-hidden rounded-lg border bg-card p-1 shadow-lg">
            {matches.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">{t("topbar.noResults")}</li>
            ) : (
              matches.map(({ id, icon: Icon }) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => go(id)}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
                  >
                    <Icon className="size-4 text-muted-foreground" aria-hidden />
                    {t(`nav.${id}`)}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setUiLang(uiLang === "en" ? "bn" : "en")}
          title={t("topbar.language")}
          aria-label={t("topbar.language")}
          className="h-8 rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {uiLang === "en" ? "বাংলা" : "English"}
        </button>
        <button
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title={t("topbar.toggleTheme")}
          aria-label={t("topbar.toggleTheme")}
          className={iconBtn}
        >
          {theme === "dark" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
        </button>
        <button
          type="button"
          onClick={() => setRoute("settings")}
          title={t("topbar.openSettings")}
          aria-label={t("topbar.openSettings")}
          className={iconBtn}
        >
          <Settings className="size-4" aria-hidden />
        </button>
      </div>
    </header>
  );
}
