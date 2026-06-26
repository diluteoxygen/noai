import browser from "webextension-polyfill";
import { ALARM_NAME, UPDATE_INTERVAL_MINUTES, DEFAULT_SETTINGS } from "../shared/constants";
import { initListMeta, updateAllLists } from "./updater";
import { addTempAllowedDomain, updateDeclarativeRules } from "./networkBlocker";
import {
  getSettings,
  saveSettings,
  getRulesForHostname,
  getListMeta,
  saveListMeta,
  getCustomLists,
  saveCustomLists,
  getChangelog,
  getMyRules,
  saveMyRules,
  getWaterStats,
  recordDomain,
} from "./storage";
import type { ListMeta, Settings, Rule, FilteringMode } from "../shared/types";

// ------------------------------------------------------------------
// Background script entry point.
// ------------------------------------------------------------------

async function reloadSettingsCache() {
  await updateDeclarativeRules();
}

// Install handler
browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const current = await browser.storage.local.get("settings");
    if (!current.settings) {
      await saveSettings({ ...DEFAULT_SETTINGS });
    }
  }
  await reloadSettingsCache();
  await initListMeta();
  await updateAllLists();
  await broadcastToTabs({ type: "RULES_UPDATED" });
});

// Startup handler
browser.runtime.onStartup.addListener(async () => {
  const existing = await browser.alarms.get(ALARM_NAME);
  if (!existing) {
    browser.alarms.create(ALARM_NAME, { periodInMinutes: UPDATE_INTERVAL_MINUTES });
  }
  await reloadSettingsCache();
  await initListMeta();
});

// Always ensure alarm exists
browser.alarms.create(ALARM_NAME, { periodInMinutes: UPDATE_INTERVAL_MINUTES });

// Alarm: periodic update
browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await updateAllLists();
    await broadcastToTabs({ type: "RULES_UPDATED" });
  }
});

// Initial cache load for service worker wakeup
reloadSettingsCache().catch(console.error);

// ------------------------------------------------------------------
// Unified message handler
// ------------------------------------------------------------------
browser.runtime.onMessage.addListener(async (rawMsg: unknown, sender: browser.Runtime.MessageSender): Promise<unknown> => {
  const msg = rawMsg as Record<string, unknown>;
  const type = msg.type as string;

  switch (type) {
    case "GET_RULES": {
      const hostname = msg.hostname as string;
      const settings = await getSettings();
      const rules = await getRulesForHostname(hostname);

      const filteringMode = settings.filteringMode;
      const siteOverride = settings.perSiteOverrides[hostname];
      
      // If filteringMode is 0, nothing is filtered. 
      // If filteringMode > 0, check per-site override.
      const siteEnabled = filteringMode > 0 && siteOverride !== true;
      
      return {
        type: "RULES_RESPONSE",
        rules: siteEnabled ? rules : [],
        filteringMode,
        siteEnabled,
      };
    }

    case "GET_SETTINGS": {
      const settings = await getSettings();
      return { type: "SETTINGS_RESPONSE", settings };
    }

    case "SET_SETTINGS": {
      const settings = msg.settings as Settings;
      await saveSettings(settings);
      await reloadSettingsCache();
      return { ok: true };
    }

    case "SET_FILTERING_MODE": {
      const mode = msg.mode as FilteringMode;
      const settings = await getSettings();
      settings.filteringMode = mode;
      await saveSettings(settings);

      // Auto-enable lists if strict mode is activated
      if (mode === 2) {
        const meta = await getListMeta();
        let changed = false;
        for (const listId of Object.keys(meta)) {
          if (meta[listId].minMode === 2 && !meta[listId].enabled) {
            meta[listId].enabled = true;
            changed = true;
          }
        }
        if (changed) {
          await saveListMeta(meta);
          await updateAllLists();
        }
      }

      await reloadSettingsCache();
      
      await broadcastToTabs({ type: "FILTERING_MODE_CHANGED", filteringMode: mode, siteEnabled: mode > 0 });
      return { ok: true };
    }

    case "SET_SITE": {
      const hostname = msg.hostname as string;
      const enabled = msg.enabled as boolean;
      const settings = await getSettings();
      // true means 'allow site' (override), false means 'remove override'
      if (enabled) {
        delete settings.perSiteOverrides[hostname];
      } else {
        settings.perSiteOverrides[hostname] = true; // disable filtering on this site
      }
      await saveSettings(settings);
      await reloadSettingsCache();

      const tabs = await browser.tabs.query({});
      for (const tab of tabs) {
        if (tab.id == null) continue;
        try {
          const url = new URL(tab.url ?? "");
          if (url.hostname === hostname) {
            browser.tabs.sendMessage(tab.id, { type: "SET_SITE", hostname, enabled }).catch(() => {});
          }
        } catch { /* ignore non-url tabs */ }
      }
      return { ok: true };
    }

    case "ALLOW_BLOCKED_SITE": {
      const hostname = msg.hostname as string;
      const permanent = msg.permanent as boolean;
      if (permanent) {
        const settings = await getSettings();
        settings.perSiteOverrides[hostname] = true;
        await saveSettings(settings);
        await reloadSettingsCache();
      } else {
        addTempAllowedDomain(hostname);
        await updateDeclarativeRules();
      }
      return { ok: true };
    }

    case "UPDATE_LISTS": {
      const result = await updateAllLists();
      await broadcastToTabs({ type: "RULES_UPDATED" });
      return { ok: result.success, quotaExceeded: result.quotaExceeded };
    }

    case "INJECT_USER_CSS": {
      if (sender.tab?.id) {
        const target = { tabId: sender.tab.id, allFrames: true };
        if (msg.remove) {
          await (browser as any).scripting.removeCSS({
            target,
            css: msg.css as string,
            origin: "USER"
          }).catch(() => {});
        } else {
          await (browser as any).scripting.insertCSS({
            target,
            css: msg.css as string,
            origin: "USER"
          }).catch(() => {});
        }
      }
      return { ok: true };
    }

    case "GET_LIST_META": {
      const builtIn = await getListMeta();
      const custom = await getCustomLists();
      const allLists: Record<string, ListMeta> = { ...builtIn };
      for (const cl of custom) allLists[cl.id] = cl;
      return { type: "LIST_META_RESPONSE", lists: allLists };
    }

    case "GET_CHANGELOG": {
      const changelog = await getChangelog();
      return { type: "CHANGELOG_RESPONSE", changelog };
    }

    case "ADD_CUSTOM_LIST": {
      const id = msg.id as string;
      const name = msg.name as string;
      const url = msg.url as string;
      const custom = await getCustomLists();
      if (custom.find((c) => c.id === id)) return { ok: false, reason: "duplicate" };
      const newMeta: ListMeta = {
        id,
        name,
        sourceUrl: url,
        license: "unknown",
        lastFetched: null,
        etag: null,
        ruleCount: 0,
        parseErrors: [],
        enabled: true,
        isBuiltIn: false,
        listType: "cosmetic", // currently UI only adds cosmetic
        minMode: 1,
      };
      custom.push(newMeta);
      await saveCustomLists(custom);
      await updateAllLists();
      return { ok: true };
    }

    case "REMOVE_CUSTOM_LIST": {
      const id = msg.id as string;
      const custom = await getCustomLists();
      await saveCustomLists(custom.filter((c) => c.id !== id));
      await updateAllLists();
      return { ok: true };
    }

    case "SET_LIST_ENABLED": {
      const id = msg.id as string;
      const enabled = msg.enabled as boolean;
      const meta = await getListMeta();
      if (meta[id]) {
        meta[id].enabled = enabled;
        await saveListMeta(meta);
        await updateAllLists();
        return { ok: true };
      }
      const custom = await getCustomLists();
      const cl = custom.find((c) => c.id === id);
      if (cl) {
        cl.enabled = enabled;
        await saveCustomLists(custom);
        await updateAllLists();
        return { ok: true };
      }
      return { ok: false, reason: "not found" };
    }

    case "ADD_MY_RULE": {
      const selector = msg.selector as string;
      const hostname = msg.hostname as string;
      const myRules = await getMyRules();
      if (!myRules.find((r) => r.selector === selector && r.hostname === hostname)) {
        myRules.push({ selector, hostname, isException: false, category: "uncategorized", sourceListId: "myRules" });
        await saveMyRules(myRules);
        await broadcastToTabs({ type: "RULES_UPDATED" });
      }
      return { ok: true };
    }

    case "DELETE_MY_RULE": {
      const selector = msg.selector as string;
      const hostname = msg.hostname as string;
      const myRules = await getMyRules();
      const filtered = myRules.filter((r) => !(r.selector === selector && r.hostname === hostname));
      if (filtered.length !== myRules.length) {
        await saveMyRules(filtered);
        await broadcastToTabs({ type: "RULES_UPDATED" });
      }
      return { ok: true };
    }

    case "GET_MY_RULES": {
      const myRules = await getMyRules();
      return { type: "MY_RULES_RESPONSE", myRules };
    }

    case "RECORD_DOMAIN": {
      await recordDomain(msg.hostname as string);
      return { ok: true };
    }

    case "GET_WATER_STATS": {
      const stats = await getWaterStats();
      return { type: "WATER_STATS_RESPONSE", stats };
    }

    default:
      return undefined;
  }
});

async function broadcastToTabs(msg: unknown): Promise<void> {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (tab.id != null) {
      browser.tabs.sendMessage(tab.id, msg).catch(() => {});
    }
  }
}

