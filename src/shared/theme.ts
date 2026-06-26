// ponytail: shared theme helper, imported by popup/options/blocked
// Reads theme preference from storage and applies it to <html>.
// Listens for system changes when set to "system".

import type { ThemePreference, AccentColor } from "./types";

type ResolvedTheme = "light" | "dark";

function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return pref;
}

const ACCENT_COLORS: Record<AccentColor, { base: string, hover: string, badgeBg: string }> = {
  blue:    { base: "#58a6ff", hover: "#79c0ff", badgeBg: "rgba(88,166,255,.08)" },
  emerald: { base: "#3fb950", hover: "#56d364", badgeBg: "rgba(63,185,80,.08)" },
  violet:  { base: "#bc8cff", hover: "#d2a8ff", badgeBg: "rgba(188,140,255,.08)" },
  rose:    { base: "#f778ba", hover: "#ff9bce", badgeBg: "rgba(247,120,186,.08)" },
  amber:   { base: "#d29922", hover: "#e3b341", badgeBg: "rgba(210,153,34,.08)" },
};

function apply(theme: ResolvedTheme, accent: AccentColor): void {
  document.documentElement.setAttribute("data-theme", theme);
  const colors = ACCENT_COLORS[accent] || ACCENT_COLORS.blue;
  document.documentElement.style.setProperty("--accent", colors.base);
  document.documentElement.style.setProperty("--accent-hover", colors.hover);
  document.documentElement.style.setProperty("--badge-bg", colors.badgeBg);
  document.documentElement.style.setProperty("--badge-text", colors.base);
  document.documentElement.style.setProperty("--btn-primary-bg", colors.base);
  document.documentElement.style.setProperty("--btn-primary-text", theme === "dark" ? "#0d1117" : "#ffffff");
  document.documentElement.style.setProperty("--btn-primary-hover", colors.hover);
  document.documentElement.style.setProperty("--shield-color", colors.base);
  document.documentElement.style.setProperty("--nav-active-bg", colors.base);
  document.documentElement.style.setProperty("--segment-active-bg", colors.base);
  document.documentElement.style.setProperty("--water-icon-color", colors.base);
}

/** Call once on page load. Returns cleanup function. */
export function initTheme(pref: ThemePreference, accent: AccentColor = "blue"): () => void {
  apply(resolveTheme(pref), accent);

  if (pref !== "system") return () => {};

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => apply(resolveTheme("system"), accent);
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}

/** Live-update without full reload (e.g. when user changes theme in settings). */
export function setTheme(pref: ThemePreference, accent: AccentColor): void {
  apply(resolveTheme(pref), accent);
}
