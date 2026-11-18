import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import {
  AudioLines,
  Captions,
  FolderKanban,
  Image,
  KeyRound,
  Settings,
  LayoutDashboard,
  Library,
  Mic,
  PenLine,
  type LucideIcon,
} from "lucide-react";

export type RouteId =
  | "dashboard"
  | "content"
  | "thumbnail"
  | "voice"
  | "voiceLibrary"
  | "audio"
  | "subtitles"
  | "projects"
  | "apiManager"
  | "settings";

export interface NavItem {
  id: RouteId;
  icon: LucideIcon;
  /** Development phase in which this page gets built. */
  phase: number;
  /** Undefined until the page exists; the shell then shows an honest "not built yet" screen. */
  page?: LazyExoticComponent<ComponentType>;
}

export const NAV: readonly NavItem[] = [
  { id: "dashboard", icon: LayoutDashboard, phase: 2, page: lazy(() => import("../features/dashboard/DashboardPage")) },
  { id: "content", icon: PenLine, phase: 4, page: lazy(() => import("../features/content/ContentPage")) },
  { id: "thumbnail", icon: Image, phase: 5, page: lazy(() => import("../features/thumbnail/ThumbnailPage")) },
  { id: "voice", icon: Mic, phase: 6, page: lazy(() => import("../features/voice/VoicePage")) },
  { id: "voiceLibrary", icon: Library, phase: 6, page: lazy(() => import("../features/voice-library/VoiceLibraryPage")) },
  { id: "audio", icon: AudioLines, phase: 7, page: lazy(() => import("../features/audio/AudioPage")) },
  { id: "subtitles", icon: Captions, phase: 7, page: lazy(() => import("../features/subtitles/SubtitlePage")) },
  { id: "projects", icon: FolderKanban, phase: 4, page: lazy(() => import("../features/projects/ProjectsPage")) },
  { id: "apiManager", icon: KeyRound, phase: 3, page: lazy(() => import("../features/api-manager/ApiManagerPage")) },
  { id: "settings", icon: Settings, phase: 2, page: lazy(() => import("../features/settings/SettingsPage")) },
];
