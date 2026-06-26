#!/usr/bin/env node
// fetch-filter-lists.js
// Downloads fresh snapshots of the bundled filter lists into lists/
// Run before building to ensure the bundled snapshots are up-to-date.

const https = require("https");
const fs = require("fs");
const path = require("path");

const LISTS = [
  {
    id: "GenAI-Blocklist",
    url: "https://raw.githubusercontent.com/Stevoisiak/Stevos-AI-Blocklist/refs/heads/main/GenAI-Blocklist.txt",
  },
  {
    id: "GenAI-Blocklist-Extra",
    url: "https://raw.githubusercontent.com/Stevoisiak/Stevos-AI-Blocklist/refs/heads/main/GenAI-Blocklist-Extra.txt",
  },
];

const LISTS_DIR = path.join(__dirname, "..", "lists");

if (!fs.existsSync(LISTS_DIR)) {
  fs.mkdirSync(LISTS_DIR, { recursive: true });
}

async function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "noai-extension/0.1 (list-fetcher)" } }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return fetchText(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

async function main() {
  for (const list of LISTS) {
    const dest = path.join(LISTS_DIR, `${list.id}.txt`);
    console.log(`Fetching ${list.id}…`);
    try {
      const text = await fetchText(list.url);
      fs.writeFileSync(dest, text, "utf8");
      const lines = text.split("\n").filter((l) => l.trim() && !l.startsWith("!")).length;
      console.log(`  ✓ ${lines} rules → lists/${list.id}.txt`);
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
      if (!fs.existsSync(dest)) {
        fs.writeFileSync(dest, `! ${list.id} — fetch failed, placeholder\n`, "utf8");
      }
    }
  }
}

main();
