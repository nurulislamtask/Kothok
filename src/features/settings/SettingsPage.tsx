import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { api, type AppInfo, type Category, type StorageInfo } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { APP_VERSION } from "../../lib/version";
import { useProviders } from "../../stores/providers";
import { toast } from "../../stores/toast";
import { useUi, type Theme, type UiLang } from "../../stores/ui";
import { useUpdate } from "../../stores/update";
import { Button, ConfirmModal } from "../../components/ui/controls";

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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 first:mt-6">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="mt-2 divide-y rounded-xl border bg-card px-5">{children}</div>
    </section>
  );
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const CATS: readonly Category[] = ["text", "image", "tts", "stt"];

export default function SettingsPage() {
  const { t } = useTranslation();
  const ui = useUi();
  const setRoute = useUi((s) => s.setRoute);
  const providers = useProviders((s) => s.providers);
  const defaults = useProviders((s) => s.defaults);
  const update = useUpdate();

  const [info, setInfo] = useState<AppInfo | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [confirmClean, setConfirmClean] = useState(false);
  const [installing, setInstalling] = useState(false);

  const loadStorage = () => {
    api.storageInfo().then(setStorage).catch(() => setStorage(null));
  };
  useEffect(() => {
    api.appInfo().then(setInfo).catch(() => setInfo(null));
    loadStorage();
  }, []);

  const checkNow = async () => {
    const r = await useUpdate.getState().check();
    if (!r && !useUpdate.getState().error) toast.success(t("settings.upToDate"));
  };

  const install = async () => {
    if (!update.info) return;
    setInstalling(true);
    try {
      await api.installUpdate(update.info.installerUrl);
    } catch (e) {
      toast.error(errorText(e));
      setInstalling(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h2 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h2>

      <Section title={t("settings.general")}>
        <Row title={t("settings.language")} hint={t("settings.languageHint")}>
          <Segmented<UiLang>
            value={ui.uiLang}
            onChange={ui.setUiLang}
            label={t("settings.language")}
            options={[
              { value: "en", label: "English" },
              { value: "bn", label: "বাংলা" },
            ]}
          />
        </Row>
        <Row title={t("settings.theme")}>
          <Segmented<Theme>
            value={ui.theme}
            onChange={ui.setTheme}
            label={t("settings.theme")}
            options={[
              { value: "dark", label: t("settings.dark") },
              { value: "light", label: t("settings.light") },
            ]}
          />
        </Row>
      </Section>

      <Section title={t("settings.performance")}>
        <Row title={t("settings.lowEnd")} hint={t("settings.lowEndHint")}>
          <input type="checkbox" className="mt-1 size-4" checked={ui.lowEnd} onChange={(e) => ui.setLowEnd(e.target.checked)} aria-label={t("settings.lowEnd")} />
        </Row>
      </Section>

      <Section title={t("settings.providers")}>
        {CATS.map((c) => {
          const id = defaults.find((d) => d.category === c)?.providerId;
          const p = providers.find((x) => x.id === id);
          return (
            <Row key={c} title={t(`api.categories.${c}`)}>
              <span className="text-sm text-muted-foreground">{p ? p.displayName : t("settings.noDefault")}</span>
            </Row>
          );
        })}
        <Row title={t("settings.manageProviders")} hint={t("settings.keysNote")}>
          <Button size="sm" onClick={() => setRoute("apiManager")}>
            {t("content.goApi")}
          </Button>
        </Row>
      </Section>

      <Section title={t("settings.storage")}>
        <Row title={t("settings.dataFolder")} hint={info?.dataDir}>
          <span />
        </Row>
        <Row
          title={t("settings.mediaUsed")}
          hint={storage ? t("settings.mediaDetail", { files: storage.mediaFiles, size: mb(storage.mediaBytes), unused: storage.unusedFiles, unusedSize: mb(storage.unusedBytes) }) : undefined}
        >
          <Button size="sm" disabled={!storage || storage.unusedFiles === 0} onClick={() => setConfirmClean(true)}>
            {t("settings.cleanUnused")}
          </Button>
        </Row>
      </Section>

      <Section title={t("settings.updates")}>
        <Row title={t("settings.autoUpdate")} hint={t("settings.autoUpdateHint")}>
          <input type="checkbox" className="mt-1 size-4" checked={ui.autoUpdate} onChange={(e) => ui.setAutoUpdate(e.target.checked)} aria-label={t("settings.autoUpdate")} />
        </Row>
        <Row
          title={update.info ? t("settings.updateAvailable", { build: update.info.build }) : t("settings.checkUpdates")}
          hint={update.error ?? (info && info.build === 0 ? t("settings.devBuild") : t("settings.updateSecurity"))}
        >
          <div className="flex gap-2">
            <Button size="sm" disabled={update.checking || installing} onClick={() => void checkNow()}>
              {update.checking ? t("settings.checking") : t("settings.checkNow")}
            </Button>
            {update.info && (
              <Button size="sm" variant="primary" disabled={installing} onClick={() => void install()}>
                {installing ? t("settings.downloading") : t("settings.installUpdate")}
              </Button>
            )}
          </div>
        </Row>
      </Section>

      <Section title={t("settings.about")}>
        <Row title={t("settings.version")}>
          <span className="text-sm text-muted-foreground">
            {info?.version ?? APP_VERSION}
            {info && info.build > 0 ? ` (build ${info.build})` : ""}
          </span>
        </Row>
      </Section>

      {confirmClean && (
        <ConfirmModal
          danger
          title={t("settings.cleanTitle")}
          body={t("settings.cleanBody", { count: storage?.unusedFiles ?? 0 })}
          confirmLabel={t("settings.cleanUnused")}
          onClose={() => setConfirmClean(false)}
          onConfirm={() => {
            setConfirmClean(false);
            api
              .cleanUnusedMedia()
              .then((n) => {
                toast.success(t("settings.cleaned", { count: n }));
                loadStorage();
              })
              .catch((e: unknown) => toast.error(errorText(e)));
          }}
        />
      )}
    </div>
  );
}
