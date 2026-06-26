import type { Category, Settings, FilteringMode } from "./types";

export const LIST_URLS = {
  // --- Cosmetic lists (CSS hiding, always fetched remotely) ---
  stevoMain: {
    id: "stevo-main",
    name: "Stevo's AI Blocklist",
    url: "https://raw.githubusercontent.com/Stevoisiak/Stevos-AI-Blocklist/refs/heads/main/GenAI-Blocklist.txt",
    license: "MIT",
    isBuiltIn: true,
    listType: "cosmetic" as const,
    minMode: 1 as const,
  },
  stevoExtra: {
    id: "stevo-extra",
    name: "Stevo's AI Blocklist — Extra",
    url: "https://raw.githubusercontent.com/Stevoisiak/Stevos-AI-Blocklist/refs/heads/main/GenAI-Blocklist-Extra.txt",
    license: "MIT",
    isBuiltIn: true,
    listType: "cosmetic" as const,
    minMode: 1 as const,
  },
  // --- Network domain lists (mode 2 only) ---
  laylavish: {
    id: "laylavish-network",
    name: "laylavish's HUGE AI Blocklist",
    url: "https://raw.githubusercontent.com/laylavish/uBlockOrigin-HUGE-AI-Blocklist/main/list.txt",
    license: "CC0",
    isBuiltIn: true,
    listType: "cosmetic" as const,
    minMode: 2 as const,
  },
  infinitytec: {
    id: "infinitytec-network",
    name: "AI Slop Domain List",
    url: "https://raw.githubusercontent.com/infinitytec/blocklists/master/ai-slop.txt",
    license: "CC0",
    isBuiltIn: true,
    listType: "network" as const,
    minMode: 2 as const,
  },
  slaptot: {
    id: "slaptot-network",
    name: "Block AI Hosts",
    url: "https://raw.githubusercontent.com/slaptot/block-ai-hosts/main/hosts",
    license: "Unlicense",
    isBuiltIn: true,
    listType: "network" as const,
    minMode: 2 as const,
  },
  aiSlop: {
    id: "ai-slop-network",
    name: "Claude AI Chatbots Blocklist",
    url: "/lists/ai-slop-chatbots-blocklist.txt",
    license: "Open Source",
    isBuiltIn: true,
    listType: "network" as const,
    minMode: 2 as const,
  },
} as const;

/** Update interval in minutes (24h) */
export const UPDATE_INTERVAL_MINUTES = 24 * 60;

/** Alarm name for the update cycle */
export const ALARM_NAME = "noai-update-lists";

export const DEFAULT_CATEGORY_ENABLED: Record<Category, boolean> = {
  searchSummaries: true,
  chatAssistants: true,
  autotags: true,
  writingAssistants: true,
  uncategorized: true,
};

export const DEFAULT_SETTINGS: Settings = {
  filteringMode: 1 as FilteringMode,
  perSiteOverrides: {},
  categoryEnabled: DEFAULT_CATEGORY_ENABLED,
  theme: "system",
  accentColor: "blue",
};

/** Maximum changelog entries to keep (rolling window) */
export const MAX_CHANGELOG_ENTRIES = 30;

/** ml of water saved per unique domain filtered per day (deduped — refresh-proof) */
// ponytail: 10ml per domain-day, UC Riverside full-lifecycle estimate.
export const ML_PER_UNIQUE_DOMAIN = 10;

/** Storage key for custom (user-added) list IDs */
export const STORAGE_KEY_CUSTOM_LISTS = "customLists";

/** Fetch timeout for remote filter lists (ms) — R1 */
export const FETCH_TIMEOUT_MS = 10_000;

/** If a list hasn't updated successfully in this long, show a stale warning — R6 */
export const STALE_UPDATE_WARNING_MS = 24 * 60 * 60 * 1000; // 24h

/** Maximum raw text size we'll accept from a list fetch (bytes) — R4 */
export const MAX_LIST_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Maximum number of lines we'll parse in a network list — R4 */
export const MAX_LIST_LINES = 150_000;
