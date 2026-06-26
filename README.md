# NoAI

You didn't ask for AI on every website. Now it is gone.

## The problem

Every site injects AI by default. There is no master switch. Per-site settings are buried. (If they exist.)

NoAI is one switch. It blocks the UI. It blocks the endpoints. 

The internet without the slop.

## Architecture

One codebase. Manifest V3. It builds for Chrome and Firefox.

It uses Declarative Net Request for endpoints. It injects user-origin CSS for the UI. (User-origin CSS pierces closed shadow DOMs without traversing them.)

The simplest engine that holds.

## Prior art

This is a wrapper. It relies on existing lists. Upstream fixes there.

- [Stevo's AI Blocklist](https://github.com/Stevoisiak/Stevos-AI-Blocklist)
- [laylavish's Huge AI Blocklist](https://github.com/laylavish/uBlockOrigin-HUGE-AI-Blocklist)
- [Fanboy's Anti-AI Suggestion List](https://github.com/easylist/easylist/blob/master/fanboy-addon/fanboy_ai_suggestions.txt)
- [uBlock Origin](https://github.com/gorhill/uBlock)

They found the nodes. We just hide them.

## Local dev

Install. Build. Load.

```bash
npm install
npm run build
```

Chrome: load the root folder in `chrome://extensions`. 
Firefox: load `manifest.json` in `about:debugging`.

The shortest path to a running extension.

## Docs

- [Contributing](CONTRIBUTING.md) — local setup.
- [Publishing](PUBLISHING.md) — store releases.
- [Security](SECURITY.md) — vulnerabilities.

Read them if you need them. Don't if you don't.

## License

MIT. The shortest license that works.
