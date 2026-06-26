# NoAI — Remove AI clutter from the internet.

> A centralized on/off switch for unsolicited AI features across the web — built the way uBlock Origin handles ads, but aimed at AI overviews, AI sidebars, AI buttons, and AI chat widgets that get grafted onto products you didn't ask to have them in.

## The problem this solves

Google Search, Gmail, Docs, YouTube, GitHub, Bing, Amazon, Reddit, X, and a growing list of everything else now inject AI UI — overviews, summarizers, assistants, auto-tags — by default, with no single browser-level switch to turn it off. Today that means hunting down a different per-product setting (if one even exists) on every single site.

This project turns "subscribe to two GitHub filter lists and hope you remembered to" into one dedicated extension with one master switch.

## Architecture & Cross-Browser Support

This extension is built on a **Universal Manifest V3 Codebase**, meaning the exact same source code compiles natively for both Google Chrome and Mozilla Firefox.

### Key Technologies
- **Declarative Net Request (DNR)**: Used for aggressive network-level blocking of known AI endpoint domains.
- **Shadow DOM Piercing**: Injects cosmetic CSS filters as user-origin stylesheets (`origin: "USER"`) to bypass closed Shadow DOMs and `!important` tags.
- **Service Workers & Event Pages**: Seamlessly bridges the gap between Chrome's Service Worker requirement and Firefox's preference for Event Pages.

## Credits & Prior Art

This project is a wrapper and an extension of existing open work. Please upstream generic filter fixes to the original projects:
- [Stevo's AI Blocklist](https://github.com/Stevoisiak/Stevos-AI-Blocklist)
- [laylavish's Huge AI Blocklist](https://github.com/laylavish/uBlockOrigin-HUGE-AI-Blocklist)
- [Fanboy's Anti-AI Suggestion List](https://github.com/easylist/easylist/blob/master/fanboy-addon/fanboy_ai_suggestions.txt)
- [uBlock Origin](https://github.com/gorhill/uBlock) — cosmetic filtering architecture inspiration.

## Developer Documentation

Looking to contribute, audit the code, or publish an update? See our guides:
- [Contributing Guide](CONTRIBUTING.md) — How to set up the project locally.
- [Publishing Guide](PUBLISHING.md) — How to package and release the extension to Chrome and Firefox.
- [Security Policy](SECURITY.md) — How to responsibly report vulnerabilities.

## Getting Started Locally

```bash
# Install dependencies
npm install

# Build the extension into a loadable format
npm run build

# Load the unpacked extension
# Chrome: Load the root folder in chrome://extensions
# Firefox: Load manifest.json in about:debugging
```

## License
MIT. Matches the filter lists this project builds on.
