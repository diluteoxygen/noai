# Contributing to NoAI

Thank you for your interest in contributing! This project aims to create a fast, private, and simple way to opt out of unsolicited AI features across the web.

## Code Architecture

Before contributing code, please read the [ARCHITECTURE.md](docs/ARCHITECTURE.md) to understand how the three layers (List Engine, Heuristic Engine, Control Layer) interact. We use a **Universal Manifest V3 Codebase** meaning the same code runs on both Firefox and Chrome.

## Setup Instructions

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/noai-extension.git
   cd noai-extension
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the extension:**
   ```bash
   npm run build
   ```
   This will compile the TypeScript source into the final JavaScript files.

## Loading the Extension Locally

### Google Chrome
1. Navigate to `chrome://extensions`.
2. Toggle **Developer mode** in the top right.
3. Click **Load unpacked** and select the root directory of this repository.

### Mozilla Firefox
1. Navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**
3. Select the `manifest.json` file in the root directory.

## Filter List Contributions

If you find an AI feature that isn't being blocked, **do not add a hardcoded rule to this repository**. 

This extension serves as a wrapper for community filter lists. Please submit your filter fixes directly to the upstream maintainers:
- [Stevo's AI Blocklist](https://github.com/Stevoisiak/Stevos-AI-Blocklist)
- [laylavish's Huge AI Blocklist](https://github.com/laylavish/uBlockOrigin-HUGE-AI-Blocklist)

Once they merge your fix, it will automatically sync down to all NoAI users within 24 hours.

## Making a Pull Request
1. Create a feature branch (`git checkout -b feature/your-feature`).
2. Make your changes and ensure `npm run build` succeeds without TypeScript errors.
3. Push to your branch and open a Pull Request.

Please keep changes focused and minimal. We prioritize extreme performance and strict privacy above all else.
