export interface Segment {
  start: number; // milliseconds
  end: number;
  text: string;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function formatTime(ms: number, sep: "," | "."): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(t % 1000, 3)}`;
}

/** Accepts HH:MM:SS,mmm / HH:MM:SS.mmm / MM:SS.mmm. Returns null when invalid. */
export function parseTime(raw: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(raw.trim());
  if (!m) return null;
  const ms = m[4] ? Number(m[4].padEnd(3, "0")) : 0;
  return Number(m[1] ?? 0) * 3_600_000 + Number(m[2]) * 60_000 + Number(m[3]) * 1000 + ms;
}

const CUE_TIME = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/;

/** Parses SRT or WebVTT text. Unknown/malformed blocks are skipped. */
export function parseSubtitles(input: string): Segment[] {
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const out: Segment[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const idx = lines.findIndex((l) => CUE_TIME.test(l));
    if (idx < 0) continue;
    const m = CUE_TIME.exec(lines[idx] ?? "");
    const start = parseTime(m?.[1] ?? "");
    const end = parseTime(m?.[2] ?? "");
    if (start === null || end === null) continue;
    const body = lines
      .slice(idx + 1)
      .join("\n")
      .trim();
    out.push({ start, end: Math.max(end, start), text: body });
  }
  return out;
}

export function formatSrt(segs: Segment[]): string {
  return segs
    .map((s, i) => `${i + 1}\n${formatTime(s.start, ",")} --> ${formatTime(s.end, ",")}\n${s.text}\n`)
    .join("\n");
}

export function formatVtt(segs: Segment[]): string {
  const body = segs.map((s) => `${formatTime(s.start, ".")} --> ${formatTime(s.end, ".")}\n${s.text}\n`).join("\n");
  return `WEBVTT\n\n${body}`;
}

export function formatTxt(segs: Segment[]): string {
  return segs.map((s) => s.text).join("\n");
}

export function shiftAll(segs: Segment[], deltaMs: number): Segment[] {
  return segs.map((s) => {
    const start = Math.max(0, s.start + deltaMs);
    return { ...s, start, end: Math.max(start, s.end + deltaMs) };
  });
}

/** Split at a character offset; the time is divided in proportion to the text. */
export function splitSegment(segs: Segment[], index: number, charOffset: number): Segment[] {
  const s = segs[index];
  if (!s) return segs;
  const first = s.text.slice(0, charOffset).trim();
  const second = s.text.slice(charOffset).trim();
  if (!first || !second) return segs;
  const ratio = first.length / (first.length + second.length);
  const mid = Math.round(s.start + (s.end - s.start) * ratio);
  return [...segs.slice(0, index), { start: s.start, end: mid, text: first }, { start: mid, end: s.end, text: second }, ...segs.slice(index + 1)];
}

export function mergeWithNext(segs: Segment[], index: number): Segment[] {
  const a = segs[index];
  const b = segs[index + 1];
  if (!a || !b) return segs;
  return [...segs.slice(0, index), { start: a.start, end: Math.max(a.end, b.end), text: `${a.text}\n${b.text}`.trim() }, ...segs.slice(index + 2)];
}

export function replaceAll(segs: Segment[], find: string, repl: string, matchCase: boolean): { segs: Segment[]; count: number } {
  if (!find) return { segs, count: 0 };
  let count = 0;
  const esc = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(esc, matchCase ? "g" : "gi");
  const next = segs.map((s) => ({
    ...s,
    text: s.text.replace(re, () => {
      count++;
      return repl;
    }),
  }));
  return { segs: next, count };
}

/** Indexes of segments that end after the next one starts, or have end before start. */
export function findProblems(segs: Segment[]): number[] {
  const bad: number[] = [];
  segs.forEach((s, i) => {
    const next = segs[i + 1];
    if (s.end < s.start || (next && s.end > next.start)) bad.push(i);
  });
  return bad;
}
