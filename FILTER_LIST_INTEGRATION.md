# Filter list integration

This project does not maintain its own AI-detection filter list from
scratch — it builds on two existing, actively-maintained, MIT-licensed
projects. This doc covers where they come from, how they're kept in sync,
and the rules for touching them.

## Sources

| List | URL | License | Notes |
|---|---|---|---|
| Stevo's AI Blocklist | `https://raw.githubusercontent.com/Stevoisiak/Stevos-AI-Blocklist/refs/heads/main/GenAI-Blocklist.txt` | MIT | Primary list. Covers 300+ sites: Google AI Overviews, YouTube Ask/summarize, Copilot (GitHub/Bing/M365/Azure), Amazon Rufus, Reddit Answers, Facebook AI chat, TikTok AI tags, X/Grok, and more. |
| Stevo's AI Blocklist — Extra | `.../GenAI-Blocklist-Extra.txt` | MIT | More experimental/subjective rules (AI subreddits, Pixiv AI-image detection, AI news category sections, mandatory-AI customer-support-chat detection). Higher false-positive risk — see note below. |
| laylavish's Huge AI Blocklist | `https://github.com/laylavish/uBlockOrigin-HUGE-AI-Blocklist` | check repo | Different scope (site-level hiding of AI-content farms from search results) — out of scope for *this* project's purpose (suppressing AI features, not AI sites) but useful to keep subscribed to separately; don't merge its rules into the same category taxonomy as the feature-suppression lists. |
| Fanboy's Anti-AI Suggestion List | `https://github.com/easylist/easylist/blob/master/fanboy-addon/fanboy_ai_suggestions.txt` | check repo | Reference/secondary source; some of its rules already fed into Stevo's list. |

Always fetch from raw URLs, not the rendered GitHub page, and always pin to
a specific branch/ref rather than scraping the HTML repo view.

## Update mechanism

- Background script fetches each source on an interval (`browser.alarms`),
  checks the `ETag`/last-modified header before re-parsing to avoid
  needless work.
- A bundled snapshot of both lists ships inside the extension package so
  the extension is useful immediately on install and resilient to a fetch
  failure later.
- Per-list metadata (last fetched, rule count, fetch errors) is surfaced in
  the options page — mirrors uBlock's filter-list dashboard, so a stale or
  broken list is visible to the user, not a silent failure.

## The "Extra" list and false positives

Stevo's project itself flags its Extra list as more prone to false
positives (subjective calls, content that's adjacent to AI rather than
clearly AI-injected UI). Default to **not** subscribing to the Extra list
out of the box; expose it as an opt-in in the options page with a short
explanation of the tradeoff, rather than bundling it silently into the
default ruleset.

## Trusted-filter / scriptlet rules

A small number of rules in Stevo's list require "trusted filter" execution
(replacing search placeholder text, removing the AI-sparkle icon on search
boxes, stopping YouTube auto-dub on direct-URL loads) because they use
scriptlets rather than plain CSS selectors. Per `CLAUDE.md` constraint 3,
this project only executes a fixed, explicitly named set of scriptlets
ported into source — never arbitrary scriptlet code pulled live from a
remote list. When a new list update references a scriptlet not yet in the
allowlist, that specific rule should be skipped (with a logged warning) and
flagged for the maintainer to review and explicitly add, not auto-executed.

## Contribution policy

If a selector is broken, missing, or too broad:

1. First check whether the fix belongs upstream (it almost always does —
   a wrong selector for `youtube.com`'s Ask button is wrong for everyone
   using that list, not just this extension).
2. Open a PR/issue against the source repo (Stevo's or laylavish's),
   following their existing contribution format (URL + screenshot of the
   unblocked item).
3. Only carry a local-only patch in this repo for something genuinely
   specific to how this extension applies rules (e.g. a syntax-subset
   limitation described in `docs/ARCHITECTURE.md`), and comment clearly why
   it isn't upstreamed.

## Licensing

Both primary sources are MIT-licensed. Keep their license text accessible
from the options page (an "about/credits" panel listing each subscribed
list, its source URL, and its license) — this is both the right thing to do
and standard practice for extensions that bundle third-party filter lists
(uBlock Origin does the same for EasyList etc. in its own filter-lists
dashboard).
