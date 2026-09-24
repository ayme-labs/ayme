import { RuntimeStateError } from "./errors";
import type { DecisionRequest } from "./decisionTypes";

const upstreamUrl = "https://openrouter.ai/api/v1/systemone";
const maxBodyBytes = 1024 * 1024;
const excludedResponseHeaders = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export type CreateDecisionEndpointOptions = {
  apiKey: string;
  authorize: (request: Request) => void | Promise<void>;
};

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isDecisionModel(model: unknown): model is string {
  return typeof model === "string" && model.startsWith("typesafe/jev-");
}

function isDecisionRequest(body: unknown): body is DecisionRequest {
  if (!body || typeof body !== "object") return false;
  const record = body as Record<string, unknown>;
  return (
    typeof record.model === "string" &&
    (typeof record.state === "string" ||
      (record.state !== null && typeof record.state === "object")) &&
    record.questions !== null &&
    typeof record.questions === "object" &&
    !Array.isArray(record.questions)
  );
}

async function readBody(request: Request): Promise<Uint8Array | undefined> {
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      byteLength += value.byteLength;
      if (byteLength > maxBodyBytes) {
        await reader.cancel().catch(() => {});
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function responseHeaders(headers: Headers): Headers {
  const filtered = new Headers(headers);
  const connectionHeaders =
    filtered
      .get("connection")
      ?.split(",")
      .map((name) => name.trim()) ?? [];
  for (const name of [
    ...excludedResponseHeaders,
    ...connectionHeaders.filter((name) => /^[!#$%&'*+.^_`|~\w-]+$/.test(name)),
  ])
    filtered.delete(name);
  return filtered;
}

export function createDecisionEndpoint({
  apiKey,
  authorize,
}: CreateDecisionEndpointOptions): (request: Request) => Promise<Response> {
  if (typeof document !== "undefined")
    throw new RuntimeStateError(
      "createDecisionEndpoint must run on the server."
    );

  return async (request) => {
    if (request.method !== "POST")
      return jsonError(405, "The request method must be POST.");

    try {
      await authorize(request);
    } catch (error) {
      if (error instanceof Response) return error;
      throw error;
    }

    const bodyBytes = await readBody(request);
    if (!bodyBytes)
      return jsonError(413, "The request body must be at most 1 MB.");

    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bodyBytes));
    } catch {
      return jsonError(400, "The request body must be valid JSON.");
    }

    if (!isDecisionRequest(body))
      return jsonError(
        400,
        "The request body must include model, state, and questions."
      );

    if (!isDecisionModel(body.model))
      return jsonError(
        400,
        "The model must be a typesafe/jev-* System One model."
      );

    try {
      const upstream = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      return new Response(await upstream.arrayBuffer(), {
        status: upstream.status,
        headers: responseHeaders(upstream.headers),
      });
    } catch (error) {
      console.error("Decision Endpoint upstream request failed.", error);
      return jsonError(502, "The model provider could not be reached.");
    }
  };
}
