/**
 * Records every Goal Loop decision request the Ayme arms' browser sends to the
 * lab app's Decision Endpoint, with the answer and how long it took, one JSON
 * line per request in the run folder's `decisions.jsonl`. The usage file holds
 * tokens per call but not what was asked; this holds what was asked, so a
 * run's calls can be told apart by stage (see `decisionStudy.ts`).
 */
import { appendFile } from "node:fs/promises";

import { decisionEndpointPath } from "./preconditions.ts";

/** The part of Playwright's request the recorder reads. */
export type RecordedRequest = {
  url(): string;
  method(): string;
  postData(): string | null;
  response(): Promise<{ status(): number; text(): Promise<string> } | null>;
};

export type RequestEvents = {
  on(
    event: "request" | "requestfinished" | "requestfailed",
    listener: (request: RecordedRequest) => void
  ): unknown;
};

/** One line of `decisions.jsonl`. */
export type DecisionRecord = {
  /** When the request was sent. */
  time: string;
  durationMs: number;
  status: number | null;
  request: unknown;
  response: unknown;
};

const parsed = (text: string | null): unknown => {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * Starts recording; `flush` waits for the lines of the requests already
 * finished, so the file is complete before the browser closes.
 */
export function recordDecisions(
  browser: RequestEvents,
  file: string
): { flush(): Promise<void> } {
  const sentAt = new WeakMap<RecordedRequest, number>();
  const pending = new Set<Promise<void>>();
  const isDecision = (request: RecordedRequest) =>
    request.method() === "POST" &&
    new URL(request.url()).pathname === decisionEndpointPath;

  const write = (request: RecordedRequest, finished: boolean) => {
    if (!isDecision(request)) return;
    const started = sentAt.get(request) ?? Date.now();
    const durationMs = Date.now() - started;
    const line = (async () => {
      const response = finished ? await request.response() : null;
      const record: DecisionRecord = {
        time: new Date(started).toISOString(),
        durationMs,
        status: response?.status() ?? null,
        request: parsed(request.postData()),
        response: response ? parsed(await response.text()) : null,
      };
      await appendFile(file, `${JSON.stringify(record)}\n`);
    })().catch(() => {});
    pending.add(line);
    void line.finally(() => pending.delete(line));
  };

  browser.on("request", (request) => {
    if (isDecision(request)) sentAt.set(request, Date.now());
  });
  browser.on("requestfinished", (request) => write(request, true));
  browser.on("requestfailed", (request) => write(request, false));
  return {
    flush: async () => {
      await Promise.all([...pending]);
    },
  };
}
