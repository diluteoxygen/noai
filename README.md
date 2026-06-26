# NoAI

[![Chrome Supported](https://img.shields.io/badge/Chrome-Supported-4285F4?logo=Google-chrome&logoColor=white)](#) [![Firefox Supported](https://img.shields.io/badge/Firefox-Supported-FF7139?logo=Mozilla-Firefox&logoColor=white)](#) [![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](#) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

You didn't ask for AI on every website. Now it is gone.

## The problem

Google Search, Gmail, YouTube, GitHub, Bing, Amazon, and Reddit inject AI UI by default. They graft overviews, summarizers, and chat widgets onto products you already use. There is no browser-level switch to turn them off. Finding per-site settings is tedious. (If the settings exist at all.)

This project turns manual configuration into a single master switch. It blocks the UI elements. It drops the network requests to AI endpoints. The internet, minus the slop.

## Architecture

This is a Universal Manifest V3 codebase. The exact same source code compiles natively for Google Chrome and Mozilla Firefox. It handles the differences between Chrome's Service Worker constraints and Firefox's Event Pages automatically.

It uses Declarative Net Request (DNR) for aggressive network-level blocking of known AI endpoint domains. For the UI, it relies on cosmetic CSS filters. It injects these filters as user-origin stylesheets. (User-origin CSS natively pierces both open and closed Shadow DOMs at the browser engine level, and overrides site `!important` tags without DOM traversal overhead.)

The simplest engine that holds the line.

## Prior art

This extension is a specialized engine for existing lists. It wraps open work. Upstream your generic filter fixes to the original maintainers:

- [Stevo's AI Blocklist](https://github.com/Stevoisiak/Stevos-AI-Blocklist)
- [laylavish's Huge AI Blocklist](https://github.com/laylavish/uBlockOrigin-HUGE-AI-Blocklist)
- [Fanboy's Anti-AI Suggestion List](https://github.com/easylist/easylist/blob/master/fanboy-addon/fanboy_ai_suggestions.txt)
- [uBlock Origin](https://github.com/gorhill/uBlock)

They found the nodes. We just hide them.

## Local dev

Install the dependencies. Build the extension into a loadable format. 

```bash
npm install
npm run build
```

For Chrome: load the unpacked root folder in `chrome://extensions`. 
For Firefox: load `manifest.json` in `about:debugging`.

The shortest path to a running extension.

## Docs

Looking to audit the code or publish an update? 
- [Contributing](CONTRIBUTING.md) — local setup.
- [Publishing](PUBLISHING.md) — store releases.
- [Security](SECURITY.md) — vulnerability reporting.

Read them if you need them. Don't if you don't.

## License

MIT. The shortest license that works.
