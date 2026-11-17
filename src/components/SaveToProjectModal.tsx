import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Project } from "../lib/api";
import { errorText } from "../lib/errors";
import { toast } from "../stores/toast";
import { Button, Field, Input, Modal, Select } from "./ui/controls";

export interface SaveTarget {
  projectId: number;
  projectName: string;
  title: string;
}

/**
 * Asks for a title and a project (existing or new), then hands the resolved
 * target to `onSave`. The caller writes the actual asset.
 */
export default function SaveToProjectModal({
  initialTitle,
  initialProjectId,
  onSave,
  onClose,
}: {
  initialTitle: string;
  initialProjectId: number | null;
  onSave: (target: SaveTarget) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState(initialTitle);
  const [projectId, setProjectId] = useState<string>(initialProjectId !== null ? String(initialProjectId) : "new");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .listProjects()
      .then((p) => {
        setProjects(p);
        if (initialProjectId === null && p[0]) setProjectId(String(p[0].id));
      })
      .catch((e: unknown) => toast.error(errorText(e)));
  }, [initialProjectId]);

  const submit = async () => {
    setBusy(true);
    try {
      let id: number;
      let name: string;
      if (projectId === "new") {
        const p = await api.createProject(newName || title || t("projects.untitled"));
        id = p.id;
        name = p.name;
      } else {
        id = Number(projectId);
        name = projects.find((p) => p.id === id)?.name ?? "";
      }
      await onSave({ projectId: id, projectName: name, title: title.trim() });
      toast.success(t("content.savedTo", { project: name }));
      onClose();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("content.saveTitle")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <Field label={t("content.docTitle")}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("content.titlePlaceholder")} />
      </Field>
      <Field label={t("content.project")}>
        <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="new">{t("content.newProject")}</option>
        </Select>
      </Field>
      {projectId === "new" && (
        <Field label={t("content.newProjectName")}>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
        </Field>
      )}
    </Modal>
  );
}
