import browser from "webextension-polyfill";
import type { Settings, StorageSchema, StorageResult, ListMeta, Rule, ChangelogEntry, WaterStats } from "../shared/types";
import { DEFAULT_SETTINGS, MAX_CHANGELOG_ENTRIES, ML_PER_UNIQUE_DOMAIN } from "../shared/constants";

// ------------------------------------------------------------------
// Typed storage accessors. All reads return a safe default on miss.
// Writes return StorageResult for quota error handling — R3.
// ------------------------------------------------------------------

/** R3: Shared quota-safe wrapper around browser.storage.local.set */
async function safePut(obj: Record<string, unknown>): Promise<StorageResult> {
  try {
    await browser.storage.local.set(obj);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Chrome: "QUOTA_BYTES quota exceeded"; Firefox: "QuotaExceededError"
    if (msg.includes("QUOTA_BYTES") || msg.includes("QuotaExceeded")) {
      console.error("[noai] Storage quota exceeded:", msg);
      return { ok: false, reason: "quota_exceeded", detail: msg };
    }
    // Re-throw unexpected errors — don't silently swallow non-quota failures
    throw err;
  }
}

export async function getSettings(): Promise<Settings> {
  const result = await browser.storage.local.get("settings");
  return (result.settings as Settings) ?? { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings: Settings): Promise<StorageResult> {
  return safePut({ settings });
}

export async function getRules(): Promise<StorageSchema["rules"]> {
  const result = await browser.storage.local.get("rules");
  return (result.rules as StorageSchema["rules"]) ?? { byHostname: {}, generic: [] };
}

export async function saveRules(rules: StorageSchema["rules"]): Promise<StorageResult> {
  return safePut({ rules });
}

export async function getMyRules(): Promise<Rule[]> {
  const result = await browser.storage.local.get("myRules");
  return (result.myRules as Rule[]) ?? [];
}

export async function saveMyRules(myRules: Rule[]): Promise<StorageResult> {
  return safePut({ myRules });
}

export async function getListMeta(): Promise<Record<string, ListMeta>> {
  const result = await browser.storage.local.get("lists");
  return (result.lists as Record<string, ListMeta>) ?? {};
}

export async function saveListMeta(lists: Record<string, ListMeta>): Promise<StorageResult> {
  return safePut({ lists });
}

export async function getChangelog(): Promise<ChangelogEntry[]> {
  const result = await browser.storage.local.get("changelog");
  return (result.changelog as ChangelogEntry[]) ?? [];
}

export async function appendChangelog(entry: ChangelogEntry): Promise<StorageResult> {
  const existing = await getChangelog();
  const updated = [entry, ...existing].slice(0, MAX_CHANGELOG_ENTRIES);
  return safePut({ changelog: updated });
}

export async function getCustomLists(): Promise<ListMeta[]> {
  const result = await browser.storage.local.get("customLists");
  return (result.customLists as ListMeta[]) ?? [];
}

export async function saveCustomLists(lists: ListMeta[]): Promise<StorageResult> {
  return safePut({ customLists: lists });
}

/**
 * Returns rules relevant to a given hostname:
 * domain-scoped rules for the hostname (or any parent domain) plus all generic rules.
 */
export async function getRulesForHostname(hostname: string): Promise<Rule[]> {
  const stored = await getRules();
  const generic = stored.generic;

  // Collect rules for hostname and parent domains (e.g. "mail.google.com" → also check "google.com")
  const parts = hostname.split(".");
  const domainRules: Rule[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const domain = parts.slice(i).join(".");
    const rules = stored.byHostname[domain] ?? [];
    domainRules.push(...rules);
  }

  // Apply exceptions: remove any generic rule whose selector is excepted for this hostname
  const exceptions = new Set(
    domainRules.filter((r) => r.isException).map((r) => r.selector)
  );

  const filtered = generic.filter((r) => !exceptions.has(r.selector));
  const nonExceptionDomain = domainRules.filter((r) => !r.isException);

  const myRules = await getMyRules();
  const myRulesForHost = myRules.filter((r) => r.hostname === hostname);

  const combined = [...filtered, ...nonExceptionDomain, ...myRulesForHost];

  // Apply minMode filtering based on current filteringMode
  const settings = await getSettings();
  const listMeta = await getListMeta();
  
  return combined.filter((r) => {
    if (r.sourceListId === "myRules") return true;
    const meta = listMeta[r.sourceListId];
    return meta && settings.filteringMode >= meta.minMode;
  });
}

// ------------------------------------------------------------------
// Water stats — domain-based proxy metric (10ml per unique domain/day)
// ------------------------------------------------------------------

const WATER_STATS_KEY = "waterStats";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

const WATER_DEFAULT: WaterStats = { allTimeMl: 0, todayDomains: [], todayDate: todayStr() };

export async function getWaterStats(): Promise<WaterStats> {
  const result = await browser.storage.local.get(WATER_STATS_KEY);
  const stored = (result[WATER_STATS_KEY] as WaterStats) ?? { ...WATER_DEFAULT };

  // Day rollover: carry earned ml into allTimeMl and reset today's set
  if (stored.todayDate !== todayStr()) {
    const rolled: WaterStats = {
      allTimeMl: stored.allTimeMl + stored.todayDomains.length * ML_PER_UNIQUE_DOMAIN,
      todayDomains: [],
      todayDate: todayStr(),
    };
    await browser.storage.local.set({ [WATER_STATS_KEY]: rolled });
    return rolled;
  }

  return stored;
}

/**
 * Record that filtering was active on `hostname` today.
 * Deduplicates — refresh-proof. Returns updated stats.
 */
export async function recordDomain(hostname: string): Promise<WaterStats> {
  const current = await getWaterStats();
  if (current.todayDomains.includes(hostname)) return current; // already counted today

  const updated: WaterStats = {
    ...current,
    todayDomains: [...current.todayDomains, hostname],
  };
  await browser.storage.local.set({ [WATER_STATS_KEY]: updated });
  return updated;
}

export async function getNetworkDomainsMap(): Promise<Record<string, string[]>> {
  const result = await browser.storage.local.get("networkDomainsMap");
  return (result.networkDomainsMap as Record<string, string[]>) ?? {};
}

export async function saveNetworkDomainsMap(map: Record<string, string[]>): Promise<StorageResult> {
  return safePut({ networkDomainsMap: map });
}

