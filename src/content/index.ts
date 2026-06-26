import browser from "webextension-polyfill";
import { init, setEnabled, countHidden } from "./cosmeticEngine";
import type { MessageType, Rule, FilteringMode } from "../shared/types";

// ------------------------------------------------------------------
// Content script entry point.
// Runs at document_start on every page.
// ------------------------------------------------------------------

// Track these at module scope so the message listener can reference them
let _filteringMode: FilteringMode = 1;
let _siteEnabled = true;
const _hostname = location.hostname;

async function main(): Promise<void> {
  // Request rules + enabled state from background
  let response: MessageType;
  try {
    response = await browser.runtime.sendMessage({
      type: "GET_RULES",
      hostname: _hostname,
    } satisfies MessageType) as MessageType;
  } catch {
    // Background not ready yet (e.g. very first install moment) — bail gracefully.
    // The next page load will succeed once the background is up.
    return;
  }

  if (response.type !== "RULES_RESPONSE") return;

  const { rules, filteringMode, siteEnabled } = response;
  _filteringMode = filteringMode ?? 1;
  _siteEnabled = siteEnabled ?? true;
  await init(rules, _filteringMode, _siteEnabled).catch(() => {});

  // Report to background for domain-based water stat tracking
  // If we applied any rules (site is enabled, mode > 0, and we have rules to apply)
  if (_filteringMode > 0 && _siteEnabled && rules && rules.length > 0) {
    browser.runtime.sendMessage({ type: "RECORD_DOMAIN", hostname: _hostname }).catch(() => {});
  }

  // Listen for messages from background (toggle changes) and popup (hidden count query)
  browser.runtime.onMessage.addListener((rawMsg: unknown): unknown => {
    const msg = rawMsg as MessageType;

    if (msg.type === "GET_HIDDEN_COUNT") {
      return Promise.resolve({ type: "HIDDEN_COUNT", count: countHidden() } satisfies MessageType);
    }

    if (msg.type === "FILTERING_MODE_CHANGED") {
      _filteringMode = msg.filteringMode ?? 1;
      // We pass the new global state to cosmeticEngine
      setEnabled(_filteringMode, _siteEnabled).catch(() => {});
      return Promise.resolve(undefined);
    }

    if (msg.type === "SET_SITE") {
      if (msg.hostname === _hostname) {
        _siteEnabled = msg.enabled ?? true;
        setEnabled(_filteringMode, _siteEnabled).catch(() => {});
      }
      return Promise.resolve(undefined);
    }

    // Background finished a list update — re-fetch rules so already-open tabs
    // get the new ruleset without needing a full page reload.
    if (msg.type === "RULES_UPDATED") {
      browser.runtime.sendMessage({
        type: "GET_RULES",
        hostname: _hostname,
      } satisfies MessageType).then((res) => {
        const r = res as MessageType;
        if (r.type === "RULES_RESPONSE") {
          _filteringMode = r.filteringMode ?? 1;
          _siteEnabled = r.siteEnabled ?? true;
          init(r.rules as Rule[], _filteringMode, _siteEnabled).catch(() => {});
          
          if (_filteringMode > 0 && _siteEnabled && r.rules && r.rules.length > 0) {
            browser.runtime.sendMessage({ type: "RECORD_DOMAIN", hostname: _hostname }).catch(() => {});
          }
        }
      }).catch(() => {});
      return Promise.resolve(undefined);
    }

    if (msg.type === "TOGGLE_ERASER") {
      import("./eraser").then((module) => {
        module.toggleEraser();
      }).catch(console.error);
      return Promise.resolve(undefined);
    }

    return undefined;
  });
}

main().catch(console.error);
