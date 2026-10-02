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
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (!source) return headers;

  const entries =
    source instanceof Headers
      ? [...source.entries()]
      : Array.isArray(source)
        ? source
        : Object.entries(source);
  for (const [key, value] of entries) headers[key] = value;
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
      throw new Error(`${response.status} ${errorText}`);
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
