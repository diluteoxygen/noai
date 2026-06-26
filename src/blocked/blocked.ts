import browser from "webextension-polyfill";
import { initTheme } from "../shared/theme";
import type { ThemePreference, AccentColor } from "../shared/types";

// Load theme
(async () => {
  try {
    const res = await browser.runtime.sendMessage({ type: "GET_SETTINGS" }) as {
      settings: { theme?: ThemePreference; accentColor?: AccentColor };
    };
    initTheme(res?.settings?.theme ?? "system", res?.settings?.accentColor ?? "blue");
  } catch {
    initTheme("system", "blue");
  }
})();

const search = window.location.search;
const blockedUrlStr = search.startsWith("?url=") ? search.substring(5) : null;

const domainDisplay = document.getElementById("domain-display") as HTMLSpanElement;
const btnBack = document.getElementById("btn-back") as HTMLButtonElement;
const btnAllowOnce = document.getElementById("btn-allow-once") as HTMLButtonElement;
const btnAllowAlways = document.getElementById("btn-allow-always") as HTMLButtonElement;

let hostname = "Unknown Site";
if (blockedUrlStr) {
  try {
    const url = new URL(blockedUrlStr);
    hostname = url.hostname;
    domainDisplay.textContent = hostname;
  } catch {
    domainDisplay.textContent = blockedUrlStr;
  }
}

btnBack.addEventListener("click", () => {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    window.close();
  }
});

async function allowSite(permanent: boolean) {
  if (!blockedUrlStr) return;
  await browser.runtime.sendMessage({
    type: "ALLOW_BLOCKED_SITE",
    hostname,
    permanent,
  });
  window.location.replace(blockedUrlStr);
}

btnAllowOnce.addEventListener("click", () => allowSite(false));
btnAllowAlways.addEventListener("click", () => allowSite(true));
