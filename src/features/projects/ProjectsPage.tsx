import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { api, type Asset, type Project } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { exportText } from "../../lib/exporters";
import { cn, formatDate } from "../../lib/utils";
import { useContent } from "../../stores/content";
import { toast } from "../../stores/toast";
import { useUi } from "../../stores/ui";
import { Badge, Button, ConfirmModal, Input, Modal } from "../../components/ui/controls";

export default function ProjectsPage() {
  const { t, i18n } = useTranslation();
  const setRoute = useUi((s) => s.setRoute);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteProject, setDeleteProject] = useState<Project | null>(null);
  const [deleteAsset, setDeleteAsset] = useState<Asset | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.listProjects();
      setProjects(list);
      setSelectedId((cur) => (cur !== null && list.some((p) => p.id === cur) ? cur : (list[0]?.id ?? null)));
    } catch (e) {
      toast.error(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selectedId === null) {
      setAssets([]);
      return;
    }
    api
      .listAssets(selectedId, null, 500)
      .then(setAssets)
      .catch((e: unknown) => toast.error(errorText(e)));
  }, [selectedId, projects]);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  const create = async () => {
    if (!newName.trim()) return;
    try {
      const p = await api.createProject(newName);
      setNewName("");
      await load();
      setSelectedId(p.id);
      toast.success(t("projects.created"));
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const exportProject = async () => {
    if (!selected) return;
    const parts = assets
      .filter((a) => a.kind === "content" && a.body)
      .map((a) => `# ${a.title || t("projects.untitled")}\n\n${a.body ?? ""}`);
    if (parts.length === 0) {
      toast.info(t("projects.nothingToExport"));
      return;
    }
    try {
      const path = await exportText(parts.join("\n\n---\n\n"), selected.name, "md");
      if (path) toast.success(t("content.exported", { path }));
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const openAsset = (a: Asset) => {
    if (a.kind === "content") {
      useContent.getState().loadAsset(a);
      setRoute("content");
    }
  };

  return (
    <div className="flex h-full">
      <aside className="flex w-72 shrink-0 flex-col border-e">
        <div className="flex gap-2 border-b p-3">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
            placeholder={t("projects.namePlaceholder")}
            aria-label={t("projects.namePlaceholder")}
          />
          <Button variant="primary" disabled={!newName.trim()} onClick={() => void create()} aria-label={t("projects.new")}>
            <FolderPlus className="size-4" aria-hidden />
          </Button>
        </div>
        <ul className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {projects.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setSelectedId(p.id)}
                className={cn(
                  "w-full rounded-lg px-3 py-2 text-start transition-colors",
                  p.id === selectedId ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">{t("projects.items", { count: p.assetCount })}</div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto p-8">
        {projects.length === 0 ? (
          <div className="mx-auto mt-16 max-w-sm text-center">
            <div className="text-sm font-medium">{t("projects.empty")}</div>
            <p className="mt-1 text-xs text-muted-foreground">{t("projects.emptyHint")}</p>
          </div>
        ) : selected ? (
          <>
            <div className="flex items-center gap-3">
              <h2 className="min-w-0 flex-1 truncate text-2xl font-semibold tracking-tight">{selected.name}</h2>
              <Button
                size="sm"
                onClick={() => {
                  setRenaming(selected);
                  setRenameValue(selected.name);
                }}
              >
                <Pencil className="size-3.5" aria-hidden />
                {t("common.rename")}
              </Button>
              <Button size="sm" onClick={() => void exportProject()}>
                <Download className="size-3.5" aria-hidden />
                {t("projects.exportMd")}
              </Button>
              <Button size="sm" variant="danger" onClick={() => setDeleteProject(selected)}>
                <Trash2 className="size-3.5" aria-hidden />
                {t("common.delete")}
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{formatDate(selected.updatedAt, i18n.language)}</p>

            <ul className="mt-6 space-y-2">
              {assets.length === 0 && <li className="text-sm text-muted-foreground">{t("projects.noItems")}</li>}
              {assets.map((a) => (
                <li key={a.id} className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
                  <Badge>{t(`projects.kinds.${a.kind}`)}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{a.title || t("projects.untitled")}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(a.createdAt, i18n.language)}</div>
                  </div>
                  {a.kind === "content" && (
                    <Button size="sm" onClick={() => openAsset(a)}>
                      {t("projects.open")}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setDeleteAsset(a)} aria-label={t("common.delete")}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      {renaming && (
        <Modal
          title={t("common.rename")}
          onClose={() => setRenaming(null)}
          footer={
            <>
              <Button onClick={() => setRenaming(null)}>{t("common.cancel")}</Button>
              <Button
                variant="primary"
                disabled={!renameValue.trim()}
                onClick={() => {
                  const id = renaming.id;
                  setRenaming(null);
                  api
                    .renameProject(id, renameValue)
                    .then(() => load())
                    .then(() => toast.success(t("projects.renamed")))
                    .catch((e: unknown) => toast.error(errorText(e)));
                }}
              >
                {t("common.save")}
              </Button>
            </>
          }
        >
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
        </Modal>
      )}
      {deleteProject && (
        <ConfirmModal
          danger
          title={t("projects.deleteTitle")}
          body={t("projects.deleteBody", { name: deleteProject.name })}
          confirmLabel={t("common.delete")}
          onClose={() => setDeleteProject(null)}
          onConfirm={() => {
            const id = deleteProject.id;
            setDeleteProject(null);
            api
              .deleteProject(id)
              .then(() => load())
              .then(() => toast.success(t("projects.deleted")))
              .catch((e: unknown) => toast.error(errorText(e)));
          }}
        />
      )}
      {deleteAsset && (
        <ConfirmModal
          danger
          title={t("projects.deleteItemTitle")}
          body={t("projects.deleteItemBody", { name: deleteAsset.title || t("projects.untitled") })}
          confirmLabel={t("common.delete")}
          onClose={() => setDeleteAsset(null)}
          onConfirm={() => {
            const id = deleteAsset.id;
            setDeleteAsset(null);
            api
              .deleteAsset(id)
              .then(() => load())
              .catch((e: unknown) => toast.error(errorText(e)));
          }}
        />
      )}
    </div>
  );
}
