/**
 * Replays a recording's network calls in a replay test. Copied from the
 * ayme-recorder skill's production automation playbook.
 *
 * Pages, scripts, styles, images and fonts requested with GET or HEAD load
 * live. Every other request is answered from the recording when `match()`
 * pairs it with a recorded call not used yet, after that call's recorded
 * duration divided by REPLAY_SPEED (default 1). Identical calls get their
 * answers in recorded order. Anything else is aborted and logged, with up to
 * three recorded calls of the same method and path to compare it with.
 *
 * The replay test also blocks service workers:
 * `test.use({ serviceWorkers: "block" })`.
 */
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

import type { BrowserContext } from "@playwright/test";

export interface Call {
  method: string;
  url: string;
  body: string | null;
}

interface RecordedCall extends Call {
  status: number;
  headers: Record<string, string>;
  responseBody: Buffer;
  duration: number;
  start: number;
}

/**
 * Whether a live request is this recorded call. Write it for the site: keep
 * what identifies a call, and leave out what changes between runs, such as
 * timestamps, counters, tokens and cache busters in the URL or body.
 */
function match(live: Call, recorded: Call): boolean {
  return (
    live.method === recorded.method &&
    live.url === recorded.url &&
    live.body === recorded.body
  );
}

const LIVE_TYPES = new Set([
  "document",
  "script",
  "stylesheet",
  "image",
  "font",
]);
// The recorded body is already decoded.
const DROPPED_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
]);
const REDIRECTS = new Set([301, 302, 307, 308]);

export async function installReplay(context: BrowserContext, traceZip: string) {
  const recorded = loadCalls(traceZip);
  const unused = [...recorded];
  const speed = Number(process.env["REPLAY_SPEED"]) || 1;
  await context.route("**/*", async (route, request) => {
    const method = request.method();
    const read = method === "GET" || method === "HEAD";
    if (read && LIVE_TYPES.has(request.resourceType())) return route.continue();
    const live: Call = { method, url: request.url(), body: request.postData() };
    const index = unused.findIndex((call) => match(live, call));
    if (index === -1) {
      const path = new URL(live.url).pathname;
      const samePath = recorded
        .filter(
          (call) =>
            call.method === method && new URL(call.url).pathname === path
        )
        .slice(0, 3)
        .map(({ url, body }) => ({ url, body }));
      console.log("replay: aborted", live, "recorded:", samePath);
      return route.abort();
    }
    const call = unused.splice(index, 1)[0]!;
    await new Promise((resolve) => setTimeout(resolve, call.duration / speed));
    // Playwright routes only a redirect chain's first request: a 303 makes the
    // browser follow with a GET instead of re-sending this request live.
    const redirect = !read && REDIRECTS.has(call.status);
    await route.fulfill({
      status: redirect ? 303 : call.status,
      headers: call.headers,
      body: call.responseBody,
    });
  });
}

function loadCalls(traceZip: string): RecordedCall[] {
  const zip = readZip(traceZip);
  const resource = (sha1: string | undefined) =>
    sha1 === undefined ? undefined : zip.get(`resources/${sha1}`)?.();
  const calls: RecordedCall[] = [];
  for (const [name, read] of zip) {
    if (!name.endsWith(".network")) continue;
    for (const line of read().toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type !== "resource-snapshot") continue;
      const { request, response, time, _monotonicTime } = event.snapshot;
      if (!(response?.status > 0)) continue; // never answered
      const headers: Record<string, string> = {};
      for (const { name: header, value } of response.headers ?? [])
        if (!DROPPED_HEADERS.has(header.toLowerCase())) headers[header] = value;
      const content = response.content ?? {};
      calls.push({
        method: request.method,
        url: request.url,
        body:
          resource(request.postData?._sha1)?.toString("utf8") ??
          request.postData?.text ??
          null,
        status: response.status,
        headers,
        responseBody:
          resource(content._sha1) ??
          Buffer.from(
            content.text ?? "",
            content.encoding === "base64" ? "base64" : "utf8"
          ),
        duration: Math.max(0, time ?? 0),
        start: _monotonicTime ?? 0,
      });
    }
  }
  // The trace writes calls as they finish; replay needs them in start order.
  return calls.sort((a, b) => a.start - b.start);
}

/** Reads a zip's entries lazily: stored and deflated entries, no zip64. */
function readZip(file: string): Map<string, () => Buffer> {
  const zip = readFileSync(file);
  let end = zip.length - 22;
  while (end > 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  const entries = new Map<string, () => Buffer>();
  let at = zip.readUInt32LE(end + 16);
  for (let i = zip.readUInt16LE(end + 10); i > 0; i--) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const local = zip.readUInt32LE(at + 42);
    const nameLength = zip.readUInt16LE(at + 28);
    entries.set(zip.toString("utf8", at + 46, at + 46 + nameLength), () => {
      const start =
        local +
        30 +
        zip.readUInt16LE(local + 26) +
        zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return method === 0 ? data : inflateRawSync(data);
    });
    at +=
      46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return entries;
}
