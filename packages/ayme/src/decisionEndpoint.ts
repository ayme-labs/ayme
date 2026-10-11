import {
  readDecisionResponse,
  type DecisionRequest,
  type DecisionResponse,
} from "./decisionWire";

export type { DecisionRequest, DecisionResponse } from "./decisionWire";

export type DecisionEndpointOptions = {
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  credentials?: RequestCredentials;
};

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

    return readDecisionResponse(url, response);
  };
}
