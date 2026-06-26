# Publishing Guide

This guide explains how to package and publish the **NoAI** extension to both the Google Chrome Web Store and the Mozilla Add-ons Hub using our Universal Manifest V3 codebase.

## The Universal Build Strategy
Our codebase is designed to run natively on both Chrome and Firefox. You do **not** need to build separate extensions or maintain two branches. When the browser loads the `manifest.json`:
- Chrome will read `"service_worker"` and ignore `"scripts"`.
- Firefox will read `"scripts"` and `"browser_specific_settings"`, ignoring `"service_worker"`.

## Step 1: Prepare the Build

1. Open your terminal and navigate to the root directory of the repository.
2. Install dependencies (if you haven't already):
   ```bash
   npm install
   ```
3. Run the production build command:
   ```bash
   npm run build:prod
   ```
   *This compiles the TypeScript files into standard JavaScript and bundles and minifies everything together.*

## Step 2: Package the Extension

The web stores require you to upload a `.zip` file containing your extension's source code.

1. Ensure the build was successful (check for any TypeScript compilation errors).
2. Create a ZIP file of the repository. **CRITICAL:** Do not zip the parent folder itself. You must select the contents *inside* the folder, so `manifest.json` is at the root level of the ZIP file.
   - Include: `src/`, `icons/`, `lists/`, `manifest.json`.
   - Exclude: `node_modules/`, `backup-mv2-final.zip`, and hidden folders like `.git/`.

Name this file `noai-release.zip`.

## Step 3: Publish to Google Chrome

1. Go to the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2. Click **Add new item** (or select your existing "NoAI" item).
3. Upload the `noai-release.zip` file.
4. Fill out the store listing details (Description, Screenshots, Promotional Tiles).
5. Submit for review. Chrome reviews typically take 1-3 days.

## Step 4: Publish to Mozilla Firefox

1. Go to the [Mozilla Add-ons Developer Hub](https://addons.mozilla.org/en-US/developers/).
2. Click **Submit a New Add-on**.
3. Choose **On this site** (to list it publicly on the AMO store).
4. Upload the exact same `noai-release.zip` file.
   * **Note:** Since the production build is minified, when submitting to AMO, you must also upload the unminified source code of this repository as a separate ZIP file when prompted, per Mozilla's reviewer requirements.
5. Firefox has an automated scanner that will immediately flag any obvious issues. If it passes, fill out your store listing.
6. Submit for review. Firefox automated reviews take minutes, though manual reviews can take longer.
