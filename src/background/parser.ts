import type { Rule, Category, ParseResult, ParseError } from "../shared/types";

// ------------------------------------------------------------------
// Filter rule parser — Phase 1 syntax subset.
// Supports:
//   ##selector              generic hide
//   example.com##selector   domain-scoped hide
//   #@#selector             generic exception (un-hide)
//   example.com#@#selector  domain-scoped exception
//   example.*##selector     TLD-wildcard domain (expanded at index time)
//   CSS :has() is STANDARD CSS (FF 121+) — NOT extended CSS, always allowed.
//
// Skipped silently:
//   ##+js(...)              scriptlets (Phase 2)
//   :style(...)             uBlock extended CSS (Phase 2)
//   :has-text(...)          uBlock procedural (Phase 2)
//   :matches-css(...)       uBlock procedural (Phase 2)
//   :nth-ancestor(...)      uBlock procedural (Phase 2)
//   :upward(...)            uBlock procedural (Phase 2)
//   :remove()               uBlock procedural (Phase 2)
//   :xpath(...)             uBlock procedural (Phase 2)
//   ||domain^               network rules (Phase 5)
//   !...                    comment lines
// ------------------------------------------------------------------

const COSMETIC_RE = /^([^#]*)##(.+)$/;
const EXCEPTION_RE = /^([^#]*)#@#(.+)$/;
const SCRIPTLET_RE = /^.*#\+js\(/;

const NETWORK_RULE_RE = /^\|{1,2}/;

// TLD wildcard: example.* — we expand these to a set of common TLDs at index time.
// Keeping this list small and focused on the TLDs that appear in the filter lists.
const COMMON_TLDS = ["com", "co.uk", "co.in", "com.au", "ca", "de", "fr", "es", "it", "nl", "pl", "ru", "br", "com.br", "mx", "jp", "kr"];

/**
 * Expand a domain that may contain a `*` TLD wildcard into concrete hostnames.
 * e.g. "www.google.*" → ["www.google.com", "www.google.co.uk", ...]
 * Non-wildcard domains are returned as-is in a single-element array.
 */
function expandDomain(domain: string): string[] {
  if (!domain.endsWith(".*")) return [domain];
  const base = domain.slice(0, -2); // strip ".*"
  return COMMON_TLDS.map((tld) => `${base}.${tld}`);
}

// Simple heuristic: classify selector into a category based on common keywords
function classifyCategory(selector: string): Category {
  const s = selector.toLowerCase();
  if (/search|overview|ai-overview|sgd-|answer-box|web-answer/.test(s)) return "searchSummaries";
  if (/chat|assistant|copilot|gemini|grok|bard|claude|sidebar/.test(s)) return "chatAssistants";
  if (/tag|label|badge|generated|ai-content/.test(s)) return "autotags";
  if (/write|compose|suggest|autocomplete|draft/.test(s)) return "writingAssistants";
  return "uncategorized";
}

function translateProcedural(selector: string): string | null {
  let s = selector;

  // Strip :remove() as our engine defaults to hiding
  s = s.replace(/:remove\(\)/gi, "");

  // Translate :upward(X) into X:has(...)
  // Works well for the most common uBlock pattern: .ad:upward(.container) -> .container:has(.ad)
  const upwardMatch = s.match(/(.*):upward\(([^)]+)\)(.*)/i);
  if (upwardMatch) {
    const inner = upwardMatch[1].trim();
    const ancestor = upwardMatch[2].trim();
    const rest = upwardMatch[3].trim();
    s = `${ancestor}:has(${inner})${rest}`;
  }

  // If there are still unsupported procedural operators, we must skip this rule
  if (/:(?:style|has-text|matches-css|nth-ancestor|xpath)\(/i.test(s)) {
    return null;
  }

  return s;
}

/**
 * Parse a raw filter list text into rules.
 */
export function parseFilterList(raw: string, sourceListId: string): ParseResult {
  const rules: Rule[] = [];
  const errors: ParseError[] = [];
  const lines = raw.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    // Empty or comment — skip silently
    if (!line || line.startsWith("!") || line.startsWith("[")) continue;

    // Network rules — out of scope for Phase 1, skip silently
    if (NETWORK_RULE_RE.test(line)) continue;

    // Scriptlets — deferred, skip with debug log
    if (SCRIPTLET_RE.test(line)) {
      console.debug(`[noai] skipping scriptlet rule (Phase 2): ${line}`);
      continue;
    }

    // Try exception rule first
    const excMatch = EXCEPTION_RE.exec(line);
    if (excMatch) {
      const domainPart = excMatch[1].trim();
      const rawSelector = excMatch[2].trim();

      const selector = translateProcedural(rawSelector);
      if (!selector) continue;

      const rawHostnames = domainPart ? domainPart.split(",").map((d) => d.trim()) : [""];
      for (const rawHost of rawHostnames) {
        for (const hostname of rawHost ? expandDomain(rawHost) : [""]) {
          rules.push({
            selector,
            hostname: hostname || null,
            isException: true,
            category: classifyCategory(selector),
            sourceListId,
          });
        }
      }
      continue;
    }

    // Try cosmetic rule
    const cosMatch = COSMETIC_RE.exec(line);
    if (cosMatch) {
      const domainPart = cosMatch[1].trim();
      const rawSelector = cosMatch[2].trim();

      const selector = translateProcedural(rawSelector);
      if (!selector) continue;

      const rawHostnames = domainPart ? domainPart.split(",").map((d) => d.trim()) : [""];
      for (const rawHost of rawHostnames) {
        for (const hostname of rawHost ? expandDomain(rawHost) : [""]) {
          rules.push({
            selector,
            hostname: hostname || null,
            isException: false,
            category: classifyCategory(selector),
            sourceListId,
          });
        }
      }
      continue;
    }

    // Unrecognised line — record as parse error
    errors.push({ line: lineNum, raw: line, reason: "Unrecognised filter syntax" });
  }

  return { rules, errors };
}

/**
 * Index parsed rules into the byHostname / generic structure for fast per-page lookup.
 */
export function indexRules(rules: Rule[]): { byHostname: Record<string, Rule[]>; generic: Rule[] } {
  const byHostname: Record<string, Rule[]> = {};
  const generic: Rule[] = [];

  for (const rule of rules) {
    if (rule.hostname === null) {
      generic.push(rule);
    } else {
      if (!byHostname[rule.hostname]) byHostname[rule.hostname] = [];
      byHostname[rule.hostname].push(rule);
    }
  }

  return { byHostname, generic };
}

/**
 * Deduplicate rules across multiple lists.
 * A rule is a duplicate if it has the same selector + hostname + isException.
 * The first occurrence (by list priority) wins.
 */
export function deduplicateRules(rules: Rule[]): Rule[] {
  const seen = new Set<string>();
  const out: Rule[] = [];
  for (const rule of rules) {
    const key = `${rule.hostname ?? ""}||${rule.selector}||${rule.isException}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(rule);
    }
  }
  return out;
}
