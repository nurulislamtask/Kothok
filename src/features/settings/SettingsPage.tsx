import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { APP_VERSION } from "../../lib/version";
import { useUi, type Theme, type UiLang } from "../../stores/ui";

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm transition-colors",
            value === o.value ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-8 py-4">
      <div className="max-w-md">
        <div className="text-sm font-medium">{title}</div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const theme = useUi((s) => s.theme);
  const uiLang = useUi((s) => s.uiLang);
  const setTheme = useUi((s) => s.setTheme);
  const setUiLang = useUi((s) => s.setUiLang);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h2 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h2>

      <section className="mt-6">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("settings.general")}</h3>
        <div className="mt-2 divide-y rounded-xl border bg-card px-5">
          <Row title={t("settings.language")} hint={t("settings.languageHint")}>
            <Segmented<UiLang>
              value={uiLang}
              onChange={setUiLang}
              label={t("settings.language")}
              options={[
                { value: "en", label: "English" },
                { value: "bn", label: "বাংলা" },
              ]}
            />
          </Row>
          <Row title={t("settings.theme")}>
            <Segmented<Theme>
              value={theme}
              onChange={setTheme}
              label={t("settings.theme")}
              options={[
                { value: "dark", label: t("settings.dark") },
                { value: "light", label: t("settings.light") },
              ]}
            />
          </Row>
        </div>
      </section>

      <section className="mt-8">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("settings.about")}</h3>
        <div className="mt-2 rounded-xl border bg-card px-5">
          <Row title={t("settings.version")}>
            <span className="text-sm text-muted-foreground">{APP_VERSION}</span>
          </Row>
        </div>
      </section>
    </div>
  );
}
