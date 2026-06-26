import browser from "webextension-polyfill";
import type { Settings } from "./types";

export type SettingsFallbackResult = 
  | { ok: true; settings: Settings }
  | { ok: false; reason: "timeout" | "error"; error?: any };

/**
 * Wraps the browser.runtime.sendMessage({ type: "GET_SETTINGS" }) call with a timeout.
 * 
 * Used by options.ts and popup.ts to gracefully handle cases where the background
 * service worker fails to wake up or throws an unhandled exception.
 * 
 * @param timeoutMs Maximum milliseconds to wait for a response
 */
export async function fetchSettingsWithFallback(timeoutMs = 2000): Promise<SettingsFallbackResult> {
  let timerId: ReturnType<typeof setTimeout>;
  
  const timeoutPromise = new Promise<SettingsFallbackResult>((resolve) => {
    timerId = setTimeout(() => {
      resolve({ ok: false, reason: "timeout" });
    }, timeoutMs);
  });

  const fetchPromise = browser.runtime.sendMessage({ type: "GET_SETTINGS" })
    .then((res: any) => {
      clearTimeout(timerId);
      if (res && res.settings) {
        return { ok: true, settings: res.settings } as SettingsFallbackResult;
      }
      return { ok: false, reason: "error", error: new Error("Malformed response") } as SettingsFallbackResult;
    })
    .catch((err) => {
      clearTimeout(timerId);
      return { ok: false, reason: "error", error: err } as SettingsFallbackResult;
    });

  return Promise.race([timeoutPromise, fetchPromise]);
}
