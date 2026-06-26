import browser from "webextension-polyfill";
import type { ListMeta, FetchResult } from "../shared/types";
import { FETCH_TIMEOUT_MS, MAX_LIST_SIZE_BYTES } from "../shared/constants";

// ------------------------------------------------------------------
// Fetcher: downloads a filter list, respects ETag to avoid re-parsing
// unchanged lists.
// ------------------------------------------------------------------

/** Content-Type prefixes we reject outright (binary data). */
const BINARY_CONTENT_TYPES = [
  "image/", "audio/", "video/", "application/octet-stream",
  "application/zip", "application/gzip", "application/pdf",
];

function isBinaryContentType(ct: string): boolean {
  const lower = ct.toLowerCase();
  return BINARY_CONTENT_TYPES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Fetch a filter list from a remote URL.
 * Sends If-None-Match if we have a stored ETag.
 *
 * Returns a discriminated union:
 *   { success: true, ... } on success or 304
 *   { success: false, reason, detail? } on any failure
 *
 * Timeout: FETCH_TIMEOUT_MS (10s) via AbortController — R1.
 * Content-Type validation: rejects binary responses — R4.
 * Size cap: rejects responses > MAX_LIST_SIZE_BYTES — R4.
 */
export async function fetchList(meta: ListMeta): Promise<FetchResult> {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {};
    if (meta.etag) {
      headers["If-None-Match"] = meta.etag;
    }

    const targetUrl = meta.sourceUrl.startsWith("/")
      ? browser.runtime.getURL(meta.sourceUrl.slice(1))
      : meta.sourceUrl;

    const res = await fetch(targetUrl, {
      headers,
      cache: "no-store",
      signal: controller.signal,
    });

    if (res.status === 304) {
      // Not modified — caller can skip re-parse
      return { success: true, text: "", etag: meta.etag, fromCache: true };
    }

    if (!res.ok) {
      return {
        success: false,
        reason: "http_error",
        detail: `HTTP ${res.status} for ${meta.id}`,
      };
    }

    // R4: Content-Type validation — reject clearly binary responses
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType && isBinaryContentType(contentType)) {
      return {
        success: false,
        reason: "bad_content_type",
        detail: `Unexpected Content-Type "${contentType}" for ${meta.id}`,
      };
    }

    // R4: Size cap — check Content-Length before reading body
    const contentLength = parseInt(res.headers.get("content-length") ?? "0", 10);
    if (contentLength > MAX_LIST_SIZE_BYTES) {
      return {
        success: false,
        reason: "bad_content_type",
        detail: `Response too large (${contentLength} bytes) for ${meta.id}`,
      };
    }

    const text = await res.text();

    // R4: Double-check actual size after reading (Content-Length can be missing/wrong)
    if (text.length > MAX_LIST_SIZE_BYTES) {
      return {
        success: false,
        reason: "bad_content_type",
        detail: `Response body too large (${text.length} bytes) for ${meta.id}`,
      };
    }

    const etag = res.headers.get("etag");
    return { success: true, text, etag, fromCache: false };
  } catch (err: unknown) {
    // R1: Distinguish timeout from other network errors
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        success: false,
        reason: "timeout",
        detail: `Fetch timed out after ${FETCH_TIMEOUT_MS}ms for ${meta.id}`,
      };
    }
    return {
      success: false,
      reason: "network",
      detail: `Network error for ${meta.id}: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    // R1: Always clear the timer
    clearTimeout(timerId);
  }
}
