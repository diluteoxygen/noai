declare const chrome: any;

import browser from "webextension-polyfill";
import { getSettings, saveSettings, getNetworkDomainsMap } from "./storage";
import { MAX_LIST_LINES, MAX_LIST_SIZE_BYTES } from "../shared/constants";
import type { DNRUpdateResult } from "../shared/types";

const BLOCKED_PAGE_URL = browser.runtime.getURL("src/blocked/blocked.html");

/**
 * Parse a network blocklist into bare domain names.
 * Handles both uBO format (||domain.com^) and hosts format (0.0.0.0 domain.com).
 *
 * R4: Caps input at MAX_LIST_SIZE_BYTES / MAX_LIST_LINES to prevent OOM.
 */
export function parseNetworkList(raw: string): string[] {
  // R4: Size gate — refuse to split a pathologically large string
  if (raw.length > MAX_LIST_SIZE_BYTES) {
    console.warn(`[noai] parseNetworkList: input too large (${raw.length} bytes), truncating`);
    raw = raw.slice(0, MAX_LIST_SIZE_BYTES);
  }

  const domains: string[] = [];
  let lineCount = 0;
  for (const rawLine of raw.split(/\r?\n/)) {
    if (++lineCount > MAX_LIST_LINES) {
      console.warn(`[noai] parseNetworkList: hit ${MAX_LIST_LINES} line cap, stopping`);
      break;
    }

    const line = rawLine.trim();
    if (!line || line.startsWith("!") || line.startsWith("#") || line.startsWith("[")) continue;

    // uBO format: ||domain.com^  or  ||domain.com^$...
    if (line.startsWith("||")) {
      const inner = line.slice(2).split("^")[0].split("$")[0].trim();
      if (inner && !inner.includes("/") && !inner.includes("*")) {
        domains.push(inner.toLowerCase());
      }
      continue;
    }

    // Hosts format: 0.0.0.0 domain.com  or  127.0.0.1 domain.com
    if (line.startsWith("0.0.0.0") || line.startsWith("127.0.0.1")) {
      const parts = line.split(/\s+/);
      const domain = parts[1]?.trim();
      if (domain && domain !== "localhost" && !domain.includes("*")) {
        domains.push(domain.toLowerCase());
      }
      continue;
    }
  }
  return domains;
}

const tempAllowedDomains = new Set<string>();

export function addTempAllowedDomain(domain: string): void {
  tempAllowedDomains.add(domain);
}

let updateQueue: Promise<DNRUpdateResult> = Promise.resolve({ success: true, added: 0, removed: 0 });

/**
 * Rebuild all declarativeNetRequest dynamic rules.
 *
 * R7: Returns a DNRUpdateResult instead of swallowing errors into console.error.
 * On failure, persists lastDNRError into Settings so the UI can surface it.
 * On success, clears lastDNRError.
 */
export function updateDeclarativeRules(): Promise<DNRUpdateResult> {
  updateQueue = updateQueue.then(async (): Promise<DNRUpdateResult> => {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = rules.map((r: any) => r.id);

    const settings = await getSettings();
    if (settings.filteringMode !== 2) {
      if (removeRuleIds.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
      }
      // Clear any stale DNR error on success path
      if (settings.lastDNRError) {
        settings.lastDNRError = null;
        await saveSettings(settings);
      }
      return { success: true, added: 0, removed: removeRuleIds.length };
    }

    const map = await getNetworkDomainsMap();
    const blockedDomains = Object.values(map).flat();

    if (blockedDomains.length === 0) {
      if (removeRuleIds.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
      }
      if (settings.lastDNRError) {
        settings.lastDNRError = null;
        await saveSettings(settings);
      }
      return { success: true, added: 0, removed: removeRuleIds.length };
    }

    const allowedDomains = Object.entries(settings.perSiteOverrides)
      .filter(([_, allowed]) => allowed === true)
      .map(([domain]) => domain);

    for (const domain of tempAllowedDomains) {
      if (!allowedDomains.includes(domain)) {
        allowedDomains.push(domain);
      }
    }

    const chunks: string[][] = [];
    for (let i = 0; i < blockedDomains.length; i += 200) {
      chunks.push(blockedDomains.slice(i, i + 200));
    }

    const addRules: any[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      addRules.push({
        id: 2 * i + 1,
        priority: 1,
        action: { type: "block" },
        condition: {
          requestDomains: chunk,
          excludedInitiatorDomains: allowedDomains,
          resourceTypes: [
            "sub_frame",
            "stylesheet",
            "script",
            "image",
            "font",
            "object",
            "xmlhttprequest",
            "ping",
            "csp_report",
            "media",
            "websocket",
            "other"
          ]
        }
      });

      addRules.push({
        id: 2 * i + 2,
        priority: 2,
        action: {
          type: "redirect",
          redirect: {
            regexSubstitution: `${BLOCKED_PAGE_URL}?url=\\0`
          }
        },
        condition: {
          regexFilter: "^https?://.*",
          resourceTypes: ["main_frame"],
          requestDomains: chunk,
          excludedRequestDomains: allowedDomains
        }
      });
    }

    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });

    // R7: Clear DNR error on success
    if (settings.lastDNRError) {
      settings.lastDNRError = null;
      await saveSettings(settings);
    }
    return { success: true, added: addRules.length, removed: removeRuleIds.length };
  }).catch(async (err): Promise<DNRUpdateResult> => {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[noai] Error updating declarative net rules:", errorMsg);

    // R7: Persist DNR error into settings so UI can surface it
    try {
      const settings = await getSettings();
      settings.lastDNRError = errorMsg;
      await saveSettings(settings);
    } catch {
      // If saving fails too, at least we logged it
    }

    return { success: false, added: 0, removed: 0, error: errorMsg };
  });
  return updateQueue;
}

export async function enableNetworkBlocking(): Promise<DNRUpdateResult> {
  return updateDeclarativeRules();
}

export async function disableNetworkBlocking(): Promise<DNRUpdateResult> {
  return updateDeclarativeRules();
}
