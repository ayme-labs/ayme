import type { DecisionRequest, DecisionResponse } from "./decisionTypes";

export type { DecisionRequest, DecisionResponse } from "./decisionTypes";

export type DecisionEndpointOptions = {
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  credentials?: RequestCredentials;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDecisionResponse(value: unknown): value is DecisionResponse {
  return (
    isRecord(value) &&
    typeof value.model === "string" &&
    isRecord(value.answers)
  );
}

async function buildHeaders(
  init?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>)
): Promise<Record<string, string>> {
  const source = typeof init === "function" ? await init() : init;
  const entries = !source
    ? []
    : source instanceof Headers
      ? [...source.entries()]
      : Array.isArray(source)
        ? source
        : Object.entries(source);
  // Header names are case-insensitive, so every casing of Content-Type
  // collapses into one entry: the caller's last value, or JSON by default.
  let contentType = "application/json";
  const headers: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (key.toLowerCase() === "content-type") contentType = value;
    else headers[key] = value;
  }
  return { "Content-Type": contentType, ...headers };
}

export function decisionEndpoint(
  url: string,
  options: DecisionEndpointOptions = {}
): (request: DecisionRequest) => Promise<DecisionResponse> {
  return async (request) => {
    const headers = await buildHeaders(options.headers);

    const response = await fetch(url, {
      method: "POST",
      headers,
      credentials: options.credentials ?? "same-origin",
      body: JSON.stringify(request),
    });

    const text = await response.text();
    if (!response.ok) {
      let errorText = text;
      try {
        const parsed = JSON.parse(text) as { error?: unknown };
        if (typeof parsed.error === "string") errorText = parsed.error;
      } catch {
        // Keep the raw body when it is not JSON.
      }
      // An endpoint that is not mounted, such as a dev server started without
      // a model key, answers 404 with an empty body; name the URL and status.
      const detail = errorText.trim() || response.statusText;
      throw new Error(
        `The Decision Endpoint ${url} answered ${response.status}${detail ? ` ${detail}` : ""}`
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("The Decision Endpoint returned an invalid response.");
    }
    if (!isDecisionResponse(parsed))
      throw new Error("The Decision Endpoint returned an invalid response.");
    return parsed;
  };
}
