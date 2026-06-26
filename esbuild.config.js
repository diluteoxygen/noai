// esbuild config for NoAI extension
// Bundles all four entry points. Non-minified for AMO source review.
const esbuild = require("esbuild");

const shared = {
  bundle: true,
  minify: process.env.NODE_ENV === 'production',
  sourcemap: false,
  platform: "browser",
  target: ["firefox115"],
  // webextension-polyfill must be bundled (no module system in content/bg scripts)
  format: "iife",
};

async function build() {
  await Promise.all([
    esbuild.build({
      ...shared,
      entryPoints: ["src/background/index.ts"],
      outfile: "src/background/index.js",
      globalName: "NoAIBackground",
    }),
    esbuild.build({
      ...shared,
      entryPoints: ["src/content/index.ts"],
      outfile: "src/content/index.js",
      globalName: "NoAIContent",
    }),
    esbuild.build({
      ...shared,
      entryPoints: ["src/popup/popup.ts"],
      outfile: "src/popup/popup.js",
      globalName: "NoAIPopup",
    }),
    esbuild.build({
      ...shared,
      entryPoints: ["src/options/options.ts"],
      outfile: "src/options/options.js",
      globalName: "NoAIOptions",
    }),
    esbuild.build({
      ...shared,
      entryPoints: ["src/blocked/blocked.ts"],
      outfile: "src/blocked/blocked.js",
      globalName: "NoAIBlocked",
    }),
  ]);
  console.log("Build complete.");
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
