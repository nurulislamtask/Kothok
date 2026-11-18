import { Suspense, useEffect } from "react";
import { useUi } from "../stores/ui";
import { NAV } from "./nav";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import StatusBar from "./StatusBar";
import ComingSoon from "../features/ComingSoon";
import Toaster from "../components/Toaster";
import { useProviders } from "../stores/providers";
import { useUpdate } from "../stores/update";
import { toast } from "../stores/toast";
import i18n from "../i18n";

export default function App() {
  const hydrated = useUi((s) => s.hydrated);
  const hydrate = useUi((s) => s.hydrate);
  const route = useUi((s) => s.route);
  const refreshProviders = useProviders((s) => s.refresh);

  useEffect(() => {
    void hydrate();
    void refreshProviders();
  }, [hydrate, refreshProviders]);

  const autoUpdate = useUi((s) => s.autoUpdate);
  // One quiet update check per launch (desktop builds only; failures are silent here).
  useEffect(() => {
    if (!hydrated || !autoUpdate) return;
    void useUpdate
      .getState()
      .check()
      .then((info) => {
        if (info) toast.info(i18n.t("settings.updateAvailableToast", { build: info.build }));
      });
  }, [hydrated, autoUpdate]);

  // Avoid a flash of the wrong theme/language before settings load.
  if (!hydrated) return null;

  const item = NAV.find((n) => n.id === route) ?? NAV[0];
  if (!item) return null;
  const Page = item.page;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-auto">
          <Suspense fallback={null}>
            {Page ? <Page /> : <ComingSoon route={item.id} phase={item.phase} />}
          </Suspense>
        </main>
        <StatusBar />
      </div>
      <Toaster />
    </div>
  );
}
