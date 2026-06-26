import browser from "webextension-polyfill";
import type { Rule } from "../shared/types";

// ------------------------------------------------------------------
// Cosmetic filter engine (content script context).
// Sends CSS rules to the background script for native injection via
// browser.tabs.insertCSS({ cssOrigin: "user" }). This natively 
// pierces all Shadow DOMs (open and closed) without JS overhead.
// ------------------------------------------------------------------

const OBSERVER_DEBOUNCE_MS = 150;

let currentRules: Rule[] = [];
let masterEnabled = true;
let siteEnabled = true;
let observerHandle: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

let lastInjectedCSS: string | null = null;

// State for generic rule processing
const pendingGenericRules: Rule[] = [];
const injectedGenericSelectors = new Set<string>();
const accumulatedElements = new Set<Element>();

/** Send CSS to background for native injection */
async function injectUserCSS(css: string) {
  if (!css.trim()) return;
  await browser.runtime.sendMessage({ type: "INJECT_USER_CSS", css });
}

/** Send CSS to background for removal */
async function removeUserCSS(css: string) {
  if (!css.trim()) return;
  await browser.runtime.sendMessage({ type: "INJECT_USER_CSS", css, remove: true });
}

let validationSheet: CSSStyleSheet | null = null;

function isValidSelector(selector: string): boolean {
  try {
    if (typeof CSSStyleSheet !== "undefined") {
      if (!validationSheet) {
        validationSheet = new CSSStyleSheet();
      }
      validationSheet.insertRule(`${selector} {}`, 0);
      validationSheet.deleteRule(0);
      return true;
    }
    const style = document.createElement("style");
    if (document.head && typeof (document.head as any).prepend === "function") {
      (document.head as any).prepend(style);
    } else {
      document.head.appendChild(style);
    }
    const sheet = style.sheet;
    let valid = false;
    if (sheet) {
      sheet.insertRule(`${selector} {}`, 0);
      valid = true;
    }
    style.remove();
    return valid;
  } catch {
    return false;
  }
}

/** Re-evaluate and apply rules */
async function applyRules(rules: Rule[]): Promise<void> {
  // Clear previously injected CSS
  if (lastInjectedCSS) {
    await removeUserCSS(lastInjectedCSS);
    lastInjectedCSS = null;
  }

  if (!masterEnabled || !siteEnabled) {
    teardownObserver();
    return;
  }

  injectedGenericSelectors.clear();
  pendingGenericRules.length = 0;

  let cssToInject = "";

  for (const rule of rules) {
    if (rule.isException) continue;

    if (!isValidSelector(rule.selector)) continue;

    if (rule.hostname !== null) {
      // Domain-specific rules: inject immediately
      cssToInject += `${rule.selector} { display: none !important; }\n`;
    } else {
      // Generic rules: check if matched in DOM first
      try {
        if (document.querySelector(rule.selector) !== null) {
          cssToInject += `${rule.selector} { display: none !important; }\n`;
          injectedGenericSelectors.add(rule.selector);
        } else {
          pendingGenericRules.push(rule);
        }
      } catch {
        // Discard invalid generic selector
      }
    }
  }

  if (cssToInject) {
    lastInjectedCSS = cssToInject;
    await injectUserCSS(cssToInject);
  }
}

/** Stop the observer and clear accumulated state, but keep rules */
function disconnectObserver(): void {
  if (observerHandle) {
    observerHandle.disconnect();
    observerHandle = null;
  }
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  accumulatedElements.clear();
}

/** Stop the observer and clear all state including rules */
function teardownObserver(): void {
  disconnectObserver();
  pendingGenericRules.length = 0;
  injectedGenericSelectors.clear();
}

/** Scan pending rules against accumulated elements */
async function processPendingRules(): Promise<void> {
  if (accumulatedElements.size === 0 || pendingGenericRules.length === 0) {
    accumulatedElements.clear();
    return;
  }

  const nextPending: Rule[] = [];
  let newCssToInject = "";

  for (const rule of pendingGenericRules) {
    let matched = false;
    let syntaxError = false;
    const isComplex = /[ >+~:]/.test(rule.selector);

    if (isComplex) {
      try {
        if (document.querySelector(rule.selector) !== null) {
          matched = true;
        }
      } catch {
        syntaxError = true;
      }
    } else {
      for (const addedEl of accumulatedElements) {
        try {
          if (addedEl.matches(rule.selector) || addedEl.querySelector(rule.selector) !== null) {
            matched = true;
            break;
          }
        } catch {
          syntaxError = true;
          break;
        }
      }
    }

    if (syntaxError) continue;

    if (matched) {
      newCssToInject += `${rule.selector} { display: none !important; }\n`;
      injectedGenericSelectors.add(rule.selector);
    } else {
      nextPending.push(rule);
    }
  }

  pendingGenericRules.length = 0;
  pendingGenericRules.push(...nextPending);
  accumulatedElements.clear();

  if (newCssToInject) {
    // Append to existing injection string so we can remove it all later if disabled
    lastInjectedCSS = (lastInjectedCSS || "") + newCssToInject;
    await injectUserCSS(newCssToInject);
  }

  if (pendingGenericRules.length === 0) {
    disconnectObserver();
  }
}

/** Set up MutationObserver to catch late-injected generic elements */
function setupObserver(): void {
  if (observerHandle) return;

  accumulatedElements.clear();

  observerHandle = new MutationObserver((mutations) => {
    let hasAdditions = false;
    for (let i = 0; i < mutations.length; i++) {
      const m = mutations[i];
      for (let j = 0; j < m.addedNodes.length; j++) {
        const node = m.addedNodes[j];
        if (node.nodeType === Node.ELEMENT_NODE) {
          accumulatedElements.add(node as Element);
          hasAdditions = true;
        }
      }
    }

    if (!hasAdditions) return;

    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      processPendingRules();
    }, OBSERVER_DEBOUNCE_MS);
  });

  observerHandle.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

// ------------------------------------------------------------------
// Public API called from index.ts
// ------------------------------------------------------------------

export async function init(rules: Rule[], filteringMode: number, site: boolean): Promise<void> {
  currentRules = rules;
  masterEnabled = filteringMode > 0;
  siteEnabled = site;
  await applyRules(currentRules);
  if (masterEnabled && siteEnabled && pendingGenericRules.length > 0) {
    setupObserver();
  } else {
    disconnectObserver();
  }
}

export async function setEnabled(filteringMode: number, site: boolean): Promise<void> {
  masterEnabled = filteringMode > 0;
  siteEnabled = site;
  await applyRules(currentRules);
  if (masterEnabled && siteEnabled && pendingGenericRules.length > 0) {
    setupObserver();
  } else {
    teardownObserver();
  }
}

export function countHidden(): number {
  if (!masterEnabled || !siteEnabled || !lastInjectedCSS) return 0;
  const uniqueElements = new Set<Element>();
  const selectors = lastInjectedCSS.split('\n').map(line => line.split('{')[0].trim()).filter(Boolean);
  
  for (const selector of selectors) {
    try {
      const elements = document.querySelectorAll(selector);
      for (let i = 0; i < elements.length; i++) {
        uniqueElements.add(elements[i]);
      }
    } catch {
      // Ignore
    }
  }
  return uniqueElements.size;
}
