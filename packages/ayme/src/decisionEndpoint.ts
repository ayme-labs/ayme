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

    return readDecisionResponse(url, response);
  };
}
