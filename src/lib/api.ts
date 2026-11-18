import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./ipc";

export type Category = "text" | "image" | "tts" | "clone" | "stt";
export type CostClass = "local" | "free" | "free_tier" | "paid";

export interface Provider {
  id: string;
  category: Category;
  adapter: string;
  displayName: string;
  endpoint: string | null;
  enabled: boolean;
  costClass: CostClass;
  settingsJson: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  hasKey: boolean;
}

export interface ProviderInput {
  id?: string;
  category: Category;
  adapter: string;
  displayName: string;
  endpoint: string | null;
  enabled: boolean;
  costClass: CostClass;
  settingsJson: string | null;
  apiKey?: string;
}

export interface ModelInfo {
  id: string;
  displayName: string | null;
}

export interface TestResult {
  ok: boolean;
  models: ModelInfo[];
  errorCode: string | null;
  errorMessage: string | null;
}

export interface DefaultRow {
  category: Category;
  providerId: string | null;
  model: string | null;
}

export interface FallbackRow {
  category: Category;
  position: number;
  providerId: string;
  model: string | null;
}

export interface GenerateInput {
  providerId?: string;
  model?: string;
  system?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  allowFallback?: boolean;
  allowPaid?: string[];
}

export interface GenerateOutput {
  text: string;
  providerId: string;
  providerName: string;
  model: string;
  fellBack: boolean;
}

export interface ImageGenInput {
  providerId?: string;
  model?: string;
  prompt: string;
  size?: string;
  aspect?: string;
}

export interface ImageGenOutput {
  dataB64: string;
  mime: string;
  providerName: string;
  model: string;
}

export type AssetKind = "content" | "audio" | "thumbnail" | "subtitle" | "transcript" | "voice_sample";

export interface Project {
  id: number;
  name: string;
  folderId: number | null;
  createdAt: string;
  updatedAt: string;
  assetCount: number;
}

export interface Asset {
  id: number;
  projectId: number | null;
  kind: AssetKind;
  title: string | null;
  filePath: string | null;
  body: string | null;
  lang: string | null;
  metaJson: string | null;
  createdAt: string;
}

export interface AssetInput {
  id?: number;
  projectId: number | null;
  kind: AssetKind;
  title: string | null;
  filePath?: string | null;
  body: string | null;
  lang: string | null;
  metaJson: string | null;
}

export interface PickedFile {
  name: string;
  mime: string;
  dataB64: string;
}


export interface VoiceInfo {
  id: string;
  name: string;
  languageCodes: string[];
  gender: string | null;
}
export interface SynthInput {
  providerId: string;
  voiceId: string;
  lang?: string;
  model?: string;
  text: string;
  speed?: number;
  pitch?: number;
}
export interface SynthOutput {
  historyId: number;
  file: string;
  providerName: string;
  chunks: number;
}
export interface TtsHistoryItem {
  id: number;
  providerId: string | null;
  voiceId: string | null;
  lang: string | null;
  textPreview: string | null;
  audioPath: string | null;
  createdAt: string;
}
export interface VoiceFavorite {
  providerId: string;
  voiceId: string;
}
export interface VoiceProfile {
  id: number;
  name: string;
  engine: string;
  samplePath: string;
  lang: string | null;
  consentConfirmedAt: string;
  consentStatement: string;
}
export interface VoiceProfileInput {
  name: string;
  lang?: string;
  sampleFile: string;
  consentConfirmed: boolean;
  consentStatement: string;
}

export interface SttSegment {
  startMs: number;
  endMs: number;
  text: string;
}
export interface TranscribeInput {
  providerId?: string;
  model?: string;
  lang?: string;
  file: string;
}
export interface TranscribeOutput {
  text: string;
  language: string | null;
  segments: SttSegment[];
  hasTiming: boolean;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw { code: "not_desktop", message: "This action needs the Kothok desktop app." };
  }
  return invoke<T>(cmd, args);
}

export const api = {
  listProviders: () => call<Provider[]>("list_providers"),
  saveProvider: (input: ProviderInput) => call<Provider>("save_provider", { input }),
  deleteProvider: (id: string) => call<void>("delete_provider", { id }),
  clearApiKey: (id: string) => call<void>("clear_api_key", { id }),
  testProvider: (id: string) => call<TestResult>("test_provider", { id }),
  setDefault: (category: Category, providerId: string) =>
    call<void>("set_default", { category, providerId }),
  getDefaults: () => call<DefaultRow[]>("get_defaults"),
  setFallbackChain: (category: Category, entries: { providerId: string; model: string | null }[]) =>
    call<void>("set_fallback_chain", { category, entries }),
  getFallbackChains: () => call<FallbackRow[]>("get_fallback_chains"),

  generate: (input: GenerateInput) => call<GenerateOutput>("ai_generate", { input }),

  listProjects: () => call<Project[]>("list_projects"),
  createProject: (name: string) => call<Project>("create_project", { name }),
  renameProject: (id: number, name: string) => call<Project>("rename_project", { id, name }),
  deleteProject: (id: number) => call<void>("delete_project", { id }),
  saveAsset: (input: AssetInput) => call<Asset>("save_asset", { input }),
  listAssets: (projectId: number | null, kind: AssetKind | null, limit?: number) =>
    call<Asset[]>("list_assets", { projectId, kind, limit: limit ?? null }),
  getAsset: (id: number) => call<Asset>("get_asset", { id }),
  deleteAsset: (id: number) => call<void>("delete_asset", { id }),

  generateImage: (input: ImageGenInput) => call<ImageGenOutput>("ai_generate_image", { input }),
  saveMedia: (ext: string, dataB64: string) => call<string>("save_media", { ext, dataB64 }),
  readMedia: (path: string) => call<PickedFile>("read_media", { path }),

  ttsListVoices: (providerId: string, lang?: string) =>
    call<VoiceInfo[]>("tts_list_voices", { providerId, lang: lang ?? null }),
  ttsSynthesize: (input: SynthInput) => call<SynthOutput>("tts_synthesize", { input }),
  ttsHistory: () => call<TtsHistoryItem[]>("tts_history_list"),
  ttsHistoryDelete: (id: number) => call<void>("tts_history_delete", { id }),
  voiceFavorites: () => call<VoiceFavorite[]>("voice_favorites"),
  voiceFavoriteSet: (providerId: string, voiceId: string, favorite: boolean) =>
    call<void>("voice_favorite_set", { providerId, voiceId, favorite }),
  voiceProfiles: () => call<VoiceProfile[]>("voice_profile_list"),
  voiceProfileCreate: (input: VoiceProfileInput) => call<VoiceProfile>("voice_profile_create", { input }),
  voiceProfileDelete: (id: number) => call<void>("voice_profile_delete", { id }),

  transcribe: (input: TranscribeInput) => call<TranscribeOutput>("stt_transcribe", { input }),
  discardMedia: (path: string) => call<void>("discard_media", { path }),

  exportFile: (suggestedName: string, filterName: string, extensions: string[], dataB64: string) =>
    call<string | null>("export_file", { suggestedName, filterName, extensions, dataB64 }),
  importFile: (filterName: string, extensions: string[]) =>
    call<PickedFile | null>("import_file", { filterName, extensions }),
};

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function textToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

/** A provider can be used for requests when enabled and (has a key, or runs locally). */
export function isReady(p: Provider): boolean {
  return p.enabled && (p.hasKey || p.costClass === "local");
}

export function savedModel(p: Provider): string {
  if (!p.settingsJson) return "";
  try {
    const v = JSON.parse(p.settingsJson) as { model?: unknown };
    return typeof v.model === "string" ? v.model : "";
  } catch {
    return "";
  }
}
