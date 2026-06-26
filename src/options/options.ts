import browser from "webextension-polyfill";
import type { ListMeta, ChangelogEntry, Category, Settings, ThemePreference, AccentColor } from "../shared/types";
import { initTheme, setTheme } from "../shared/theme";
import { STALE_UPDATE_WARNING_MS } from "../shared/constants";
import { fetchSettingsWithFallback } from "../shared/settingsUtils";

// ------------------------------------------------------------------
// Options page script — Phase 1 + Phase 2 features.
// No innerHTML with dynamic content — uses DOM construction throughout
// to satisfy AMO review and avoid web-ext lint UNSAFE_VAR_ASSIGNMENT.
// ------------------------------------------------------------------

const CATEGORY_INFO: Record<Category, { name: string; desc: string }> = {
  searchSummaries: {
    name: "Search summaries",
    desc: "AI overview boxes on Google, Bing, and other search engines.",
  },
  chatAssistants: {
    name: "Chat assistants",
    desc: "Copilot, Gemini side panels, Grok buttons, and in-product AI chat.",
  },
  autotags: {
    name: "Auto-tags & labels",
    desc: "AI-generated content badges and auto-applied AI labels.",
  },
  writingAssistants: {
    name: "Writing assistants",
    desc: '"Help me write", autocomplete suggestions, and AI-powered compose features.',
  },
  uncategorized: {
    name: "Other / uncategorized",
    desc: "Rules that don't fit a specific category.",
  },
};

const CREDIT_INFO = [
  {
    name: "Stevo's AI Blocklist",
    url: "https://github.com/Stevoisiak/Stevos-AI-Blocklist",
    license: "MIT",
    desc: "Primary list. Covers 300+ sites: Google AI Overviews, YouTube Ask/summarize, Copilot, Amazon Rufus, Reddit Answers, Grok, and more.",
  },
  {
    name: "laylavish's Huge AI Blocklist",
    url: "https://github.com/laylavish/uBlockOrigin-HUGE-AI-Blocklist",
    license: "See repo",
    desc: "Reference project with a different scope (site-level AI content hiding) — credited for inspiration and prior art.",
  },
  {
    name: "Fanboy's Anti-AI Suggestion List",
    url: "https://github.com/easylist/easylist",
    license: "See repo",
    desc: "Reference/secondary source; some rules already fed into Stevo's list.",
  },
];

// ------------------------------------------------------------------
// DOM helpers — safe, no innerHTML needed
// ------------------------------------------------------------------
type Attrs = Record<string, string | boolean>;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (string | Node | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    if (typeof child === "string") node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

function makeToggle(checked: boolean, cls = "", dataAttrs: Attrs = {}): {
  label: HTMLLabelElement;
  input: HTMLInputElement;
} {
  const input = el("input", { type: "checkbox", class: cls, ...dataAttrs });
  (input as HTMLInputElement).checked = checked;
  const thumb = el("span", { class: "toggle-thumb" });
  const track = el("span", { class: "toggle-track" }, thumb);
  const label = el("label", { class: "toggle-switch" }, input, track);
  return { label, input: input as HTMLInputElement };
}

// ------------------------------------------------------------------
// Navigation
// ------------------------------------------------------------------
function initNav(): void {
  const navItems = document.querySelectorAll(".nav-item");
  const sections = document.querySelectorAll(".section");

  navItems.forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      const target = item.getAttribute("href")?.replace("#", "");
      if (!target) return;

      navItems.forEach((n) => n.classList.remove("active"));
      item.classList.add("active");

      sections.forEach((s) => {
        s.classList.toggle("hidden", s.id !== `section-${target}`);
      });
    });
  });
}

// ------------------------------------------------------------------
// Filter Lists section
// ------------------------------------------------------------------
async function loadFilterLists(): Promise<void> {
  const container = document.getElementById("list-cards")!;
  container.textContent = "";

  const res = (await browser.runtime.sendMessage({ type: "GET_LIST_META" })) as {
    lists: Record<string, ListMeta>;
  };
  const lists = Object.values(res.lists).sort((a) => (a.isBuiltIn ? -1 : 1));

  for (const meta of lists) {
    container.appendChild(buildListCard(meta));
  }
}

function buildListCard(meta: ListMeta): HTMLElement {
  const isExtra = meta.id === "stevo-extra";
  const lastFetched = meta.lastFetched
    ? new Date(meta.lastFetched).toLocaleString()
    : "Never (using bundled snapshot)";

  // Title row
  const titleEl = el("div", { class: "card-title" }, meta.name);
  if (isExtra) {
    titleEl.appendChild(
      el("span", { class: "badge badge-warning" }, "Opt-in · Higher false-positive risk")
    );
  }
  if (meta.parseErrors.length > 0) {
    titleEl.appendChild(
      el(
        "span",
        { class: "badge badge-error" },
        `${meta.parseErrors.length} parse error${meta.parseErrors.length !== 1 ? "s" : ""}`
      )
    );
  }

  // R6: Surface fetch failures / stale updates
  const isStale = meta.lastFetched !== null && (Date.now() - meta.lastFetched > STALE_UPDATE_WARNING_MS);
  if (meta.lastError && isStale) {
    titleEl.appendChild(
      el(
        "span",
        { class: "badge badge-error" },
        `Stale (Failing to update: ${meta.lastError})`
      )
    );
  }

  const descEl = el("div", { class: "card-desc" }, meta.sourceUrl);

  const { label: toggleLabel, input: toggleInput } = makeToggle(
    meta.enabled,
    "list-enabled-toggle"
  );
  toggleLabel.title = meta.enabled ? "Disable this list" : "Enable this list";
  toggleInput.dataset["id"] = meta.id;

  const headerLeft = el("div", {}, titleEl, descEl);
  const cardHeader = el("div", { class: "card-header" }, headerLeft, toggleLabel);

  // Meta row
  const metaRow = el(
    "div",
    { class: "card-meta" },
    el(
      "div",
      { class: "meta-item" },
      el("span", { class: "meta-label" }, "Rules"),
      el("span", { class: "meta-value" }, meta.ruleCount.toLocaleString())
    ),
    el(
      "div",
      { class: "meta-item" },
      el("span", { class: "meta-label" }, "Last updated"),
      el("span", { class: "meta-value" }, lastFetched)
    ),
    el(
      "div",
      { class: "meta-item" },
      el("span", { class: "meta-label" }, "License"),
      el("span", { class: "meta-value" }, meta.license)
    )
  );

  // Parse errors
  let errorBanner: HTMLElement | undefined;
  let errorDetails: HTMLElement | undefined;
  if (meta.parseErrors.length > 0) {
    const errLines = meta.parseErrors
      .slice(0, 20)
      .map((e) => `Line ${e.line}: ${e.raw} — ${e.reason}`)
      .join("\n");
    const overflow =
      meta.parseErrors.length > 20 ? `\n…and ${meta.parseErrors.length - 20} more` : "";

    errorDetails = el("pre", { class: "parse-error-details", id: `errors-${meta.id}` }, errLines + overflow);
    errorBanner = el(
      "div",
      { class: "parse-error-banner", "data-id": meta.id },
      `⚠ ${meta.parseErrors.length} line${meta.parseErrors.length !== 1 ? "s" : ""} couldn't be parsed — click to expand`
    );
    errorBanner.addEventListener("click", () => {
      errorDetails!.classList.toggle("open");
    });
  }

  // Actions
  const updateBtn = el("button", { class: "btn btn-secondary update-list-btn", "data-id": meta.id }, "↻ Update now");
  const actionsEl = el("div", { class: "card-actions" }, updateBtn);

  if (!meta.isBuiltIn) {
    const removeBtn = el("button", { class: "btn btn-danger remove-list-btn", "data-id": meta.id }, "Remove");
    actionsEl.appendChild(removeBtn);
    removeBtn.addEventListener("click", async () => {
      if (!confirm(`Remove "${meta.name}"?`)) return;
      await browser.runtime.sendMessage({ type: "REMOVE_CUSTOM_LIST", id: meta.id });
      await loadFilterLists();
    });
  }

  // Assemble card
  const card = el(
    "div",
    { class: "card", id: `list-card-${meta.id}` },
    cardHeader,
    metaRow
  );
  if (errorBanner) card.appendChild(errorBanner);
  if (errorDetails) card.appendChild(errorDetails);
  card.appendChild(actionsEl);

  // Toggle enabled
  toggleInput.addEventListener("change", async () => {
    await browser.runtime.sendMessage({ type: "SET_LIST_ENABLED", id: meta.id, enabled: toggleInput.checked });
    await loadFilterLists();
  });

  // Update now
  updateBtn.addEventListener("click", async () => {
    (updateBtn as HTMLButtonElement).disabled = true;
    updateBtn.textContent = "Updating…";
    const res = await browser.runtime.sendMessage({ type: "UPDATE_LISTS" }) as { ok: boolean, quotaExceeded?: boolean };
    if (res && res.quotaExceeded) {
      alert("Failed to update lists: Storage quota exceeded. Please remove some custom lists or rules.");
    }
    await loadFilterLists();
  });

  return card;
}

function initCustomListForm(): void {
  const form = document.getElementById("custom-list-form") as HTMLFormElement;
  const errorEl = document.getElementById("custom-list-error")!;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("custom-list-name") as HTMLInputElement;
    const urlInput = document.getElementById("custom-list-url") as HTMLInputElement;
    const btn = document.getElementById("btn-add-list") as HTMLButtonElement;

    const name = nameInput.value.trim();
    const url = urlInput.value.trim();
    if (!name || !url) return;

    const id = `custom-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
    btn.disabled = true;
    errorEl.classList.add("hidden");

    try {
      const res = (await browser.runtime.sendMessage({ type: "ADD_CUSTOM_LIST", id, name, url })) as {
        ok: boolean;
        reason?: string;
      };

      if (!res.ok) {
        errorEl.textContent =
          res.reason === "duplicate"
            ? "A list with a similar name already exists."
            : `Failed to add list: ${res.reason ?? "unknown error"}`;
        errorEl.classList.remove("hidden");
      } else {
        nameInput.value = "";
        urlInput.value = "";
        await loadFilterLists();
      }
    } finally {
      btn.disabled = false;
    }
  });
}

// ------------------------------------------------------------------
// Changelog section
// ------------------------------------------------------------------
async function loadChangelog(): Promise<void> {
  const container = document.getElementById("changelog-content")!;
  container.textContent = "";

  const res = (await browser.runtime.sendMessage({ type: "GET_CHANGELOG" })) as {
    changelog: ChangelogEntry[];
  };

  if (!res.changelog || res.changelog.length === 0) {
    container.appendChild(
      el("p", { class: "empty-state" }, "No updates recorded yet. Lists update automatically every 24 hours.")
    );
    return;
  }

  for (const entry of res.changelog) {
    const time = new Date(entry.timestamp).toLocaleString();
    const pillsEl = el("div", { class: "changelog-pills" });

    for (const s of entry.added.slice(0, 15)) {
      const p = el("span", { class: "pill pill-added", title: s }, `+ ${truncate(s, 40)}`);
      pillsEl.appendChild(p);
    }
    for (const s of entry.removed.slice(0, 15)) {
      const p = el("span", { class: "pill pill-removed", title: s }, `− ${truncate(s, 40)}`);
      pillsEl.appendChild(p);
    }
    if (entry.added.length > 15) pillsEl.appendChild(el("span", { class: "meta-value" }, `…+${entry.added.length - 15} more added`));
    if (entry.removed.length > 15) pillsEl.appendChild(el("span", { class: "meta-value" }, `…+${entry.removed.length - 15} more removed`));

    const entryEl = el(
      "div",
      { class: "changelog-entry" },
      el("div", { class: "changelog-time" }, `${time} — +${entry.added.length} / −${entry.removed.length} rules`),
      pillsEl
    );
    container.appendChild(entryEl);
  }
}

// ------------------------------------------------------------------
// Categories section
// ------------------------------------------------------------------
async function loadCategories(): Promise<void> {
  const container = document.getElementById("category-list")!;
  container.textContent = "";

  const res = (await browser.runtime.sendMessage({ type: "GET_SETTINGS" })) as {
    settings: Settings;
  };
  const settings = res.settings;

  for (const [key, info] of Object.entries(CATEGORY_INFO) as [Category, { name: string; desc: string }][]) {
    const enabled = settings.categoryEnabled[key] ?? true;

    const { label: toggleLabel, input: toggleInput } = makeToggle(enabled, "category-toggle");
    (toggleInput as HTMLInputElement & { dataset: DOMStringMap }).dataset["key"] = key;

    const infoEl = el(
      "div",
      { class: "category-info" },
      el("span", { class: "category-name" }, info.name),
      el("span", { class: "category-desc" }, info.desc)
    );

    const row = el("div", { class: "category-row" }, infoEl, toggleLabel);

    toggleInput.addEventListener("change", async () => {
      const current = (await browser.runtime.sendMessage({ type: "GET_SETTINGS" })) as { settings: Settings };
      const s = current.settings;
      s.categoryEnabled[key] = toggleInput.checked;
      await browser.runtime.sendMessage({ type: "SET_SETTINGS", settings: s });
    });

    container.appendChild(row);
  }
}

// ------------------------------------------------------------------
// About section
// ------------------------------------------------------------------
function loadAbout(): void {
  const container = document.getElementById("credit-cards")!;
  container.textContent = "";

  for (const c of CREDIT_INFO) {
    const link = el("a", { class: "text-link", href: c.url, target: "_blank", rel: "noopener" }, `${c.url} ↗`);
    const card = el(
      "div",
      { class: "credit-card" },
      el("div", { class: "credit-name" }, c.name),
      el("div", { class: "credit-meta" }, `License: ${c.license}`),
      el("p", { class: "card-desc" }, c.desc),
      link
    );
    container.appendChild(card);
  }
}

// ------------------------------------------------------------------
// Utilities
// ------------------------------------------------------------------
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// ------------------------------------------------------------------
// My Rules section
// ------------------------------------------------------------------
async function loadMyRules(): Promise<void> {
  const container = document.getElementById("my-rules-list")!;
  container.textContent = "";

  const res = (await browser.runtime.sendMessage({ type: "GET_MY_RULES" })) as {
    myRules: import("../shared/types").Rule[];
  };

  if (!res.myRules || res.myRules.length === 0) {
    container.appendChild(
      el("p", { class: "empty-state" }, "You haven't hidden any elements yet.")
    );
    return;
  }

  const byHost: Record<string, import("../shared/types").Rule[]> = {};
  for (const r of res.myRules) {
    const host = r.hostname || "Global";
    if (!byHost[host]) byHost[host] = [];
    byHost[host].push(r);
  }

  for (const [host, rules] of Object.entries(byHost)) {
    const hostHeader = el("h3", { class: "my-rules-host" }, host);
    container.appendChild(hostHeader);

    for (const rule of rules) {
      const deleteBtn = el("button", { class: "btn btn-danger btn-sm" }, "Remove");
      deleteBtn.addEventListener("click", async () => {
        await browser.runtime.sendMessage({
          type: "DELETE_MY_RULE",
          selector: rule.selector,
          hostname: rule.hostname || ""
        });
        await loadMyRules();
      });

      const ruleEl = el(
        "div",
        { class: "my-rule-item" },
        el("code", { class: "my-rule-selector", title: rule.selector }, truncate(rule.selector, 60)),
        deleteBtn
      );
      container.appendChild(ruleEl);
    }
  }
}

// ------------------------------------------------------------------
// Appearance section
// ------------------------------------------------------------------
async function loadAppearance(): Promise<void> {
  const res = (await browser.runtime.sendMessage({ type: "GET_SETTINGS" })) as {
    settings: Settings;
  };
  const theme = res.settings.theme ?? "system";
  const accent = res.settings.accentColor ?? "blue";
  
  const themeRadios = document.querySelectorAll('input[name="theme"]') as NodeListOf<HTMLInputElement>;
  themeRadios.forEach((r) => {
    if (r.value === theme) r.checked = true;
    r.addEventListener("change", async () => {
      if (!r.checked) return;
      const newTheme = r.value as ThemePreference;
      const current = (await browser.runtime.sendMessage({ type: "GET_SETTINGS" })) as { settings: Settings };
      setTheme(newTheme, current.settings.accentColor ?? "blue");
      initTheme(newTheme, current.settings.accentColor ?? "blue");
      current.settings.theme = newTheme;
      await browser.runtime.sendMessage({ type: "SET_SETTINGS", settings: current.settings });
    });
  });

  const accentRadios = document.querySelectorAll('input[name="accentColor"]') as NodeListOf<HTMLInputElement>;
  accentRadios.forEach((r) => {
    if (r.value === accent) r.checked = true;
    r.addEventListener("change", async () => {
      if (!r.checked) return;
      const newAccent = r.value as AccentColor;
      const current = (await browser.runtime.sendMessage({ type: "GET_SETTINGS" })) as { settings: Settings };
      setTheme(current.settings.theme ?? "system", newAccent);
      initTheme(current.settings.theme ?? "system", newAccent);
      current.settings.accentColor = newAccent;
      await browser.runtime.sendMessage({ type: "SET_SETTINGS", settings: current.settings });
    });
  });
}

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------
async function init(): Promise<void> {
  const fetchResult = await fetchSettingsWithFallback(2000);
  
  if (!fetchResult.ok) {
    console.error("[noai] Options page failed to load settings:", fetchResult.reason, fetchResult.error);
    const errorBanner = document.getElementById("bg-error-banner");
    if (errorBanner) errorBanner.classList.remove("hidden");
    
    // Disable interactions by hiding all sections
    document.querySelectorAll(".section").forEach(s => s.classList.add("hidden"));
    
    // Render a safe theme so it isn't unstyled white flash
    initTheme("system", "blue");
    return; // Halt initialization
  }

  const settings = fetchResult.settings;
  initTheme(settings.theme ?? "system", settings.accentColor ?? "blue");

  // R7: Surface DNR error if one exists
  if (settings.lastDNRError) {
    const errorBanner = document.getElementById("bg-error-banner");
    if (errorBanner) {
      errorBanner.innerHTML = `<span>⚠ <strong>Network Filtering Error:</strong> </span>`;
      const errorText = document.createTextNode(`${truncate(settings.lastDNRError, 100)}. Strict mode blocking may be degraded.`);
      errorBanner.querySelector('span')!.appendChild(errorText);
      errorBanner.classList.remove("hidden");
    }
  }

  initNav();
  await loadFilterLists();
  loadAbout();
  initCustomListForm();

  // Lazy-load sections
  document.getElementById("nav-my-rules")?.addEventListener("click", loadMyRules);
  document.getElementById("nav-changelog")?.addEventListener("click", loadChangelog);
  document.getElementById("nav-categories")?.addEventListener("click", loadCategories);
  document.getElementById("nav-appearance")?.addEventListener("click", loadAppearance);
}

init().catch(console.error);
