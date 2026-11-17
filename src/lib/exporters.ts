import { api, textToBase64 } from "./api";

export type TextFormat = "txt" | "md" | "docx";

export function safeName(name: string, fallback: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 80);
  return cleaned || fallback;
}

const HEADING = ["HEADING_1", "HEADING_2", "HEADING_3"] as const;

async function docxBase64(text: string): Promise<string> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
  // Nirmala UI ships with Windows and renders Bengali; set it for complex scripts too.
  const font = { ascii: "Nirmala UI", hAnsi: "Nirmala UI", cs: "Nirmala UI", eastAsia: "Nirmala UI" };
  const paragraphs = text.split(/\r?\n/).map((line) => {
    const m = /^(#{1,3})\s+(.*)$/.exec(line);
    if (m && m[1] && m[2] !== undefined) {
      const level = HeadingLevel[HEADING[m[1].length - 1] ?? "HEADING_1"];
      return new Paragraph({ heading: level, children: [new TextRun({ text: m[2], font, bold: true })] });
    }
    return new Paragraph({ children: [new TextRun({ text: line, font })] });
  });
  const doc = new Document({ sections: [{ children: paragraphs }] });
  return Packer.toBase64String(doc);
}

/** Opens a native "Save as" dialog. Resolves to the saved path, or null if cancelled. */
export async function exportText(text: string, baseName: string, format: TextFormat): Promise<string | null> {
  const name = `${safeName(baseName, "kothok")}.${format}`;
  if (format === "docx") {
    return api.exportFile(name, "Word document", ["docx"], await docxBase64(text));
  }
  const label = format === "md" ? "Markdown" : "Text";
  return api.exportFile(name, label, [format], textToBase64(text));
}
