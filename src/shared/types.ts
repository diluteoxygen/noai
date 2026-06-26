// Shared types for the NoAI extension.
// Keep this file free of browser API imports — it's imported by all contexts.

export type Category =
  | "searchSummaries"
  | "chatAssistants"
  | "autotags"
  | "writingAssistants"
  | "uncategorized";

/**
 * 0 = Off (no filtering)
 * 1 = Cosmetic (CSS-only hide rules — current behaviour)
 * 2 = Aggressive (CSS + network-level domain blocking via webRequest)
 */
export type FilteringMode = 0 | 1 | 2;

export type ThemePreference = "system" | "light" | "dark";
export type AccentColor = "blue" | "emerald" | "violet" | "rose" | "amber";

// --- Resilience types (R1–R7) ---

export type FetchFailureReason = "timeout" | "network" | "bad_content_type" | "http_error";

export type FetchResult =
  | { success: true; text: string; etag: string | null; fromCache: boolean }
  | { success: false; reason: FetchFailureReason; detail?: string };

export type StorageResult =
  | { ok: true }
  | { ok: false; reason: "quota_exceeded"; detail?: string };

export interface DNRUpdateResult {
  success: boolean;
  added: number;
  removed: number;
  error?: string;
}

export interface Rule {
  selector: string;
  /** null = generic (applies everywhere) */
  hostname: string | null;
  isException: boolean;
  category: Category;
  sourceListId: string;
}

export interface Settings {
  filteringMode: FilteringMode;
  perSiteOverrides: Record<string, boolean>;
  categoryEnabled: Record<Category, boolean>;
  theme: ThemePreference;
  accentColor: AccentColor;
  lastDNRError?: string | null;
}

export interface ListMeta {
  id: string;
  name: string;
  sourceUrl: string;
  license: string;
  lastFetched: number | null; // epoch ms
  etag: string | null;
  ruleCount: number;
  parseErrors: ParseError[];
  enabled: boolean;
  isBuiltIn: boolean;
  /** "cosmetic" = parsed for CSS hide rules; "network" = parsed for domains to block */
  listType: "cosmetic" | "network";
  minMode: 1 | 2;
  lastError?: FetchFailureReason;
}

export interface ParseError {
  line: number;
  raw: string;
  reason: string;
}

export interface ParseResult {
  rules: Rule[];
  errors: ParseError[];
}

export interface ChangelogEntry {
  listId: string;
  timestamp: number;
  added: string[];   // raw selectors added
  removed: string[]; // raw selectors removed
}

export interface StorageSchema {
  settings: Settings;
  lists: Record<string, ListMeta>;
  rules: {
    byHostname: Record<string, Rule[]>;
    generic: Rule[];
  };
  myRules: Rule[];
  changelog: ChangelogEntry[];
}

export interface WaterStats {
  /** Total millilitres saved across all time (persisted) */
  allTimeMl: number;
  /** Unique hostnames where filtering was active today — resets at midnight */
  todayDomains: string[];
  /** "YYYY-MM-DD" used to detect day rollover */
  todayDate: string;
}

// Messages between background and content/popup
export type MessageType =
  | { type: "GET_RULES"; hostname: string }
  | { type: "RULES_RESPONSE"; rules: Rule[]; filteringMode: FilteringMode; siteEnabled: boolean }
  | { type: "GET_SETTINGS" }
  | { type: "SETTINGS_RESPONSE"; settings: Settings }
  | { type: "SET_FILTERING_MODE"; mode: FilteringMode }
  | { type: "SET_SITE"; hostname: string; enabled: boolean }
  | { type: "UPDATE_LISTS" }
  | { type: "GET_HIDDEN_COUNT" }
  | { type: "HIDDEN_COUNT"; count: number }
  | { type: "RULES_UPDATED" }
  | { type: "INJECT_USER_CSS"; css: string; remove?: boolean }
  | { type: "TOGGLE_ERASER" }
  | { type: "ADD_MY_RULE"; selector: string; hostname: string }
  | { type: "DELETE_MY_RULE"; selector: string; hostname: string }
  | { type: "GET_MY_RULES" }
  | { type: "MY_RULES_RESPONSE"; myRules: Rule[] }
  | { type: "RECORD_DOMAIN"; hostname: string }
  | { type: "GET_WATER_STATS" }
  | { type: "WATER_STATS_RESPONSE"; stats: WaterStats }
  | { type: "FILTERING_MODE_CHANGED"; filteringMode: FilteringMode; siteEnabled: boolean }
  | { type: "ALLOW_BLOCKED_SITE"; hostname: string; permanent: boolean };
