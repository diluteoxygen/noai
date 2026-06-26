import browser from "webextension-polyfill";
import type { WaterStats, FilteringMode, ThemePreference, AccentColor } from "../shared/types";
import { ML_PER_UNIQUE_DOMAIN } from "../shared/constants";
import { initTheme } from "../shared/theme";
import { fetchSettingsWithFallback } from "../shared/settingsUtils";

// ------------------------------------------------------------------
// Popup script — wires up the UI to background messages.
// ponytail: removed duplicate settings button, simplified water rendering
// ------------------------------------------------------------------

const GITHUB_ISSUE_URL =
  "https://github.com/diluteoxygen/noai/issues/new";

async function init(): Promise<void> {
  // Get current tab hostname
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  let hostname = "";
  try {
    hostname = new URL(tab.url ?? "").hostname;
  } catch {
    hostname = "";
  }

  // R5: Get settings with timeout fallback
  const fetchResult = await fetchSettingsWithFallback(1500); // 1.5s timeout for popup
  
  if (!fetchResult.ok) {
    console.error("[noai] Popup failed to load settings:", fetchResult.reason, fetchResult.error);
    const errorBanner = document.getElementById("bg-error-banner");
    if (errorBanner) errorBanner.classList.remove("hidden");
    
    // Disable interactions
    document.querySelector(".popup")?.classList.add("disabled");
    
    // Render an empty safe state
    document.getElementById("site-hostname")!.textContent = hostname || "this page";
    initTheme("system", "blue");
    return; // Halt initialization
  }

  const settings = fetchResult.settings;

  // Apply theme
  initTheme((settings.theme ?? "system") as ThemePreference, (settings.accentColor ?? "blue") as AccentColor);

  const filteringMode = settings.filteringMode;
  const siteOverride = settings.perSiteOverrides[hostname];
  const siteEnabled = filteringMode > 0 && siteOverride !== true;

  // DOM refs
  const modeRadios = document.querySelectorAll('input[name="filteringMode"]') as NodeListOf<HTMLInputElement>;
  const modeControl = document.getElementById("mode-control")!;
  const siteToggle = document.getElementById("site-toggle") as HTMLInputElement;
  const siteHostnameEl = document.getElementById("site-hostname")!;
  const siteStatusEl = document.getElementById("site-status")!;
  const statHidden = document.getElementById("stat-hidden")!;
  const statRules = document.getElementById("stat-rules")!;
  const statusMessage = document.getElementById("status-message")!;
  const btnReport = document.getElementById("btn-report") as HTMLAnchorElement;
  const btnOptions = document.getElementById("btn-options") as HTMLAnchorElement;

  // Set hostname display
  siteHostnameEl.textContent = hostname || "this page";
  siteHostnameEl.title = hostname;

  // Set initial states
  modeControl.setAttribute("data-value", String(filteringMode));
  siteToggle.checked = siteEnabled;
  updateSiteStatus(siteEnabled);
  updateDisabledState(filteringMode);

  // Ask active tab content script for hidden count
  if (tab.id != null) {
    try {
      const countRes = await browser.tabs.sendMessage(tab.id, { type: "GET_HIDDEN_COUNT" }) as {
        type: string;
        count: number;
      };
      const count = countRes?.count ?? 0;
      statHidden.textContent = String(count);
      statusMessage.textContent = count > 0
        ? `${count} AI element${count !== 1 ? "s" : ""} hidden on this page`
        : "No AI elements detected on this page yet";
    } catch {
      statHidden.textContent = "—";
      statusMessage.textContent = "Page not injectable";
    }
  }

  // Get rule count from list meta
  try {
    const metaRes = await browser.runtime.sendMessage({ type: "GET_LIST_META" }) as {
      type: string;
      lists: Record<string, { ruleCount: number; enabled: boolean }>;
    };
    const totalRules = Object.values(metaRes.lists)
      .filter((l) => l.enabled)
      .reduce((sum, l) => sum + l.ruleCount, 0);
    statRules.textContent = totalRules > 0 ? totalRules.toLocaleString() : "0";
  } catch {
    statRules.textContent = "—";
  }

  // Fetch and render water stats
  try {
    const waterRes = await browser.runtime.sendMessage({ type: "GET_WATER_STATS" }) as {
      type: string;
      stats: WaterStats;
    };
    if (waterRes?.stats) {
      renderWaterStats(waterRes.stats);
    }
  } catch {
    // Non-fatal — water section stays at 0
  }

  // Report link
  btnReport.href = `${GITHUB_ISSUE_URL}?body=${encodeURIComponent(`**Page:** ${tab.url ?? ""}\n\n**AI feature that wasn't blocked:**\n\n<!-- Please describe what AI element you saw and include a screenshot if possible -->`)}`;
  btnReport.addEventListener("click", (e) => {
    e.preventDefault();
    browser.tabs.create({ url: btnReport.href });
    window.close();
  });

  // Options page link (gear icon in header — single entry point)
  btnOptions.addEventListener("click", (e) => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
    window.close();
  });

  // Mode radio buttons
  modeRadios.forEach((radio) => {
    if (parseInt(radio.value) === filteringMode) radio.checked = true;

    radio.addEventListener("change", async () => {
      if (radio.checked) {
        const mode = parseInt(radio.value) as FilteringMode;

        if (mode === 2) {
          const skipWarning = (await browser.storage.local.get("skipStrictModeWarning"))["skipStrictModeWarning"];
          if (!skipWarning) {
            const modal = document.getElementById("confirm-modal")!;
            const btnCancel = document.getElementById("modal-btn-cancel")!;
            const btnProceed = document.getElementById("modal-btn-proceed")!;
            const chkDontShow = document.getElementById("modal-dont-show-again") as HTMLInputElement;

            modal.classList.remove("hidden");

            const result = await new Promise<boolean>((resolve) => {
              const onCancel = () => { cleanup(); resolve(false); };
              const onProceed = () => { cleanup(); resolve(true); };

              function cleanup() {
                modal.classList.add("hidden");
                btnCancel.removeEventListener("click", onCancel);
                btnProceed.removeEventListener("click", onProceed);
              }

              btnCancel.addEventListener("click", onCancel);
              btnProceed.addEventListener("click", onProceed);
            });

            if (result && chkDontShow.checked) {
              await browser.storage.local.set({ skipStrictModeWarning: true });
            }

            if (!result) {
              const currentMode = modeControl.getAttribute("data-value") || "1";
              const prevRadio = document.querySelector(`input[name="filteringMode"][value="${currentMode}"]`) as HTMLInputElement;
              if (prevRadio) prevRadio.checked = true;
              return;
            }
          }
        }

        await browser.runtime.sendMessage({ type: "SET_FILTERING_MODE", mode });
        modeControl.setAttribute("data-value", String(mode));
        updateDisabledState(mode);

        if (mode === 0) {
          siteToggle.checked = false;
          updateSiteStatus(false);
        } else {
          const sRes = await browser.runtime.sendMessage({ type: "GET_SETTINGS" }) as {
            settings: { perSiteOverrides: Record<string, boolean> };
          };
          const enabled = sRes.settings.perSiteOverrides[hostname] !== true;
          siteToggle.checked = enabled;
          updateSiteStatus(enabled);
        }
      }
    });
  });

  // Per-site toggle
  siteToggle.addEventListener("change", async () => {
    const enabled = siteToggle.checked;
    await browser.runtime.sendMessage({ type: "SET_SITE", hostname, enabled });
    updateSiteStatus(enabled);
  });

  // AI Eraser button
  const btnEraser = document.getElementById("btn-eraser") as HTMLButtonElement;
  btnEraser.addEventListener("click", async (e) => {
    e.preventDefault();
    if (tab.id != null) {
      await browser.tabs.sendMessage(tab.id, { type: "TOGGLE_ERASER" }).catch(() => {});
    }
    window.close();
  });

  function updateSiteStatus(enabled: boolean): void {
    siteStatusEl.textContent = enabled
      ? "Blocking enabled on this site"
      : "Blocking disabled on this site";
  }

  function updateDisabledState(mode: FilteringMode): void {
    document.querySelector(".popup")?.classList.toggle("disabled", mode === 0);
  }
}

// ------------------------------------------------------------------
// Water tracker — simplified, no SVG animation
// ------------------------------------------------------------------

function formatWater(ml: number): string {
  if (ml < 1_000) return `${ml} ml`;
  if (ml < 1_000_000) return `${(ml / 1_000).toFixed(ml < 10_000 ? 1 : 0)} L`;
  return `${(ml / 1_000_000).toFixed(1)} kL`;
}

function renderWaterStats(stats: WaterStats): void {
  const amountEl = document.getElementById("water-amount")!;
  const finalMl = stats.allTimeMl + (stats.todayDomains.length * ML_PER_UNIQUE_DOMAIN);
  
  if (finalMl === 0) {
    amountEl.textContent = formatWater(0);
    return;
  }

  const durationMs = 800; // ponytail: crisp 800ms animation
  const start = performance.now();
  
  function step(timestamp: number) {
    const elapsed = timestamp - start;
    const progress = Math.min(elapsed / durationMs, 1);
    
    // easeOutExpo
    const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
    const currentMl = Math.floor(finalMl * ease);
    
    amountEl.textContent = formatWater(currentMl);
    
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      amountEl.textContent = formatWater(finalMl);
    }
  }
  
  requestAnimationFrame(step);
}

init().catch(console.error);
