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
  const headers: Record<string, string> = Object.fromEntries(entries);
  // Header names are case-insensitive, and a Headers instance lower-cases them.
  if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type"))
    headers["Content-Type"] = "application/json";
  return headers;
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
