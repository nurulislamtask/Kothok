import { api } from "../../lib/api";

/** Reads a stored audio file and returns a blob URL the <audio> element can play. */
export async function audioUrl(file: string): Promise<string> {
  const f = await api.readMedia(file);
  const bin = atob(f.dataB64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: f.mime }));
}
