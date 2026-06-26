import browser from "webextension-polyfill";
import { fetchList } from "./fetcher";
import { parseFilterList, indexRules, deduplicateRules } from "./parser";
import { parseNetworkList, updateDeclarativeRules } from "./networkBlocker";
import {
  getListMeta,
  saveListMeta,
  getRules,
  saveRules,
  getCustomLists,
  saveCustomLists,
  appendChangelog,
  getNetworkDomainsMap,
  saveNetworkDomainsMap,
} from "./storage";
import { LIST_URLS } from "../shared/constants";
import type { ListMeta, Rule, ChangelogEntry } from "../shared/types";

/** Initialize list metadata on first install (if missing). */
export async function initListMeta(): Promise<void> {
  const existing = await getListMeta();
  let changed = false;

  const validIds = new Set<string>(Object.values(LIST_URLS).map(d => d.id));
  
  for (const id of Object.keys(existing)) {
    if (existing[id].isBuiltIn && !validIds.has(id)) {
      delete existing[id];
      changed = true;
    }
  }

  for (const def of Object.values(LIST_URLS)) {
    if (!existing[def.id]) {
      existing[def.id] = {
        id: def.id,
        name: def.name,
        sourceUrl: def.url,
        license: def.license,
        lastFetched: null,
        etag: null,
        ruleCount: 0,
        parseErrors: [],
        enabled: def.id === LIST_URLS.stevoMain.id,
        isBuiltIn: true,
        listType: def.listType,
        minMode: def.minMode,
      };
      changed = true;
    } else {
      if (existing[def.id].listType !== def.listType) {
        existing[def.id].listType = def.listType;
        changed = true;
      }
      if (existing[def.id].minMode !== def.minMode) {
        existing[def.id].minMode = def.minMode;
        changed = true;
      }
    }
  }

  if (changed) await saveListMeta(existing);
}

// ------------------------------------------------------------------
// R2: In-memory mutex — prevents overlapping update cycles.
// If called while running, returns the in-flight Promise so both
// callers await the same result. Lock is released in `finally`.
//
// An in-memory lock is appropriate here: if the service worker
// terminates mid-update, the next wakeup starts with no lock
// (desired behavior). A storage.session lock could deadlock if
// the worker dies without cleanup.
// ------------------------------------------------------------------
let inFlightUpdate: Promise<{ success: boolean; quotaExceeded?: boolean }> | null = null;

/**
 * Run one update cycle: fetch all enabled lists, parse, deduplicate, store.
 * Network lists are parsed into domain sets and loaded into the network blocker.
 *
 * R2: If already running, returns the in-flight Promise (coalesces calls).
 * R6: Stores lastError per list so the UI can surface stale warnings.
 */
export async function updateAllLists(): Promise<{ success: boolean; quotaExceeded?: boolean }> {
  if (inFlightUpdate) return inFlightUpdate;

  inFlightUpdate = _doUpdate();
  try {
    return await inFlightUpdate;
  } finally {
    inFlightUpdate = null;
  }
}

async function _doUpdate(): Promise<{ success: boolean; quotaExceeded?: boolean }> {
  const listMeta = await getListMeta();
  const customLists = await getCustomLists();

  const allMeta: Record<string, ListMeta> = { ...listMeta };
  for (const cl of customLists) allMeta[cl.id] = cl;

  const enabledMeta = Object.values(allMeta).filter((m) => m.enabled);

  const allCosmeticRules: Rule[] = [];
  const updatedMeta: Record<string, ListMeta> = { ...listMeta };

  const previousRulesStore = await getRules();
  const previousAll: Rule[] = [
    ...previousRulesStore.generic,
    ...Object.values(previousRulesStore.byHostname).flat(),
  ];

  const networkDomainsMap = await getNetworkDomainsMap();
  const updatedNetworkMap: Record<string, string[]> = {};

  for (const meta of enabledMeta) {
    const fetchResult = await fetchList(meta);

    // R6: Handle fetch failures with typed errors instead of swallowing
    if (!fetchResult.success) {
      console.warn(`[noai] Fetch failed for ${meta.id}: ${fetchResult.reason} — ${fetchResult.detail ?? ""}`);

      // Preserve previous data so we don't lose working rules
      if (meta.listType === "network") {
        updatedNetworkMap[meta.id] = networkDomainsMap[meta.id] ?? [];
      } else if (meta.listType === "cosmetic") {
        allCosmeticRules.push(...previousAll.filter((r) => r.sourceListId === meta.id));
      }

      // R6: Record the failure reason on the meta
      updatedMeta[meta.id] = {
        ...meta,
        lastError: fetchResult.reason,
      };
      continue;
    }

    if (fetchResult.fromCache) {
      // 304 — re-use existing data
      if (meta.listType === "cosmetic") {
        allCosmeticRules.push(...previousAll.filter((r) => r.sourceListId === meta.id));
      } else if (meta.listType === "network") {
        updatedNetworkMap[meta.id] = networkDomainsMap[meta.id] ?? [];
      }
      continue;
    }

    // R6: Clear lastError on successful fetch
    if (meta.listType === "network") {
      const domains = parseNetworkList(fetchResult.text);
      updatedNetworkMap[meta.id] = domains;
      updatedMeta[meta.id] = {
        ...meta,
        lastFetched: Date.now(),
        etag: fetchResult.etag ?? meta.etag,
        ruleCount: domains.length,
        parseErrors: [],
        listType: "network",
        lastError: undefined,
      };
    } else {
      const { rules, errors } = parseFilterList(fetchResult.text, meta.id);
      allCosmeticRules.push(...rules);
      updatedMeta[meta.id] = {
        ...meta,
        lastFetched: Date.now(),
        etag: fetchResult.etag ?? meta.etag,
        ruleCount: rules.length,
        parseErrors: errors,
        listType: "cosmetic",
        lastError: undefined,
      };
    }
  }

  // Save the updated network domains map and update DNR rules
  const netSaveResult = await saveNetworkDomainsMap(updatedNetworkMap);
  if (!netSaveResult.ok) {
    console.error("[noai] Failed to save network domains map:", netSaveResult.detail);
    return { success: false, quotaExceeded: true };
  }
  
  const dnrResult = await updateDeclarativeRules();
  if (!dnrResult.success) {
    console.error("[noai] DNR update failed:", dnrResult.error);
  }

  // Deduplicate and store cosmetic rules
  const deduped = deduplicateRules(allCosmeticRules);
  const previousKeys = new Set(previousAll.map((r) => `${r.hostname ?? ""}||${r.selector}`));
  const nextKeys = new Set(deduped.map((r) => `${r.hostname ?? ""}||${r.selector}`));

  const added = deduped
    .filter((r) => !previousKeys.has(`${r.hostname ?? ""}||${r.selector}`))
    .map((r) => r.selector);
  const removed = previousAll
    .filter((r) => !nextKeys.has(`${r.hostname ?? ""}||${r.selector}`))
    .map((r) => r.selector);

  const indexed = indexRules(deduped);
  const rulesSaveResult = await saveRules(indexed);
  if (!rulesSaveResult.ok) {
    console.error("[noai] Failed to save rules (quota exceeded):", rulesSaveResult.detail);
    return { success: false, quotaExceeded: true };
  }

  const nextBuiltIn: Record<string, ListMeta> = {};
  const nextCustom: ListMeta[] = [];
  for (const metaId of Object.keys(updatedMeta)) {
    const meta = updatedMeta[metaId];
    if (meta.isBuiltIn) {
      nextBuiltIn[metaId] = meta;
    } else {
      nextCustom.push(meta);
    }
  }
  await saveListMeta(nextBuiltIn);
  await saveCustomLists(nextCustom);

  if (added.length > 0 || removed.length > 0) {
    const entry: ChangelogEntry = {
      listId: "all",
      timestamp: Date.now(),
      added,
      removed,
    };
    await appendChangelog(entry);
  }

  console.log(`[noai] Update complete: ${deduped.length} cosmetic rules active, +${added.length}/-${removed.length}`);
  return { success: true };
}
