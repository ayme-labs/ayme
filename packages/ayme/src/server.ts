import {
  decisionErrorResponse,
  isDecisionRequest,
  isRecord,
} from "./decisionWire";
import { RuntimeStateError } from "./errors";

/** Where each provider serves System One, and the Jev version the Goal Loop's
 *  questions are tuned for, in that provider's model id. */
const providers: Record<
  CreateDecisionEndpointOptions["provider"],
  { url: string; model: string }
> = {
  openrouter: {
    url: "https://openrouter.ai/api/v1/systemone",
    model: "typesafe/jev-1.13",
  },
  typesafe: {
    url: "https://api.typesafe.ai/v1/systemone",
    model: "jev-1.13.0",
  },
};

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
  provider: "openrouter" | "typesafe";
  apiKey: string;
  authorize: (request: Request) => void | Promise<void>;
};

/** The message of a provider's error body: TypeSafe's `detail.message` or
 *  OpenRouter's `error.message`. */
function upstreamErrorMessage(text: string): string | undefined {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(body)) return undefined;
  for (const field of [body.detail, body.error]) {
    if (isRecord(field) && typeof field.message === "string")
      return field.message;
  }
  return undefined;
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

/** @experimental */
export function createDecisionEndpoint({
  provider,
  apiKey,
  authorize,
}: CreateDecisionEndpointOptions): (request: Request) => Promise<Response> {
  if (typeof document !== "undefined")
    throw new RuntimeStateError(
      "createDecisionEndpoint must run on the server."
    );
  if (!Object.hasOwn(providers, provider))
    throw new RuntimeStateError(
      'The provider must be "openrouter" or "typesafe".'
    );
  const upstream = providers[provider];

  return async (request) => {
    if (request.method !== "POST")
      return decisionErrorResponse(405, "The request method must be POST.");

    try {
      await authorize(request);
    } catch (error) {
      if (error instanceof Response) return error;
      throw error;
    }

    const bodyBytes = await readBody(request);
    if (!bodyBytes)
      return decisionErrorResponse(
        413,
        "The request body must be at most 1 MB."
      );

    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bodyBytes));
    } catch {
      return decisionErrorResponse(400, "The request body must be valid JSON.");
    }

    if (!isDecisionRequest(body))
      return decisionErrorResponse(
        400,
        "The request body must include state and questions."
      );

    try {
      const response = await fetch(upstream.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: upstream.model,
          state: body.state,
          questions: body.questions,
        }),
      });
      if (!response.ok)
        return decisionErrorResponse(
          response.status,
          upstreamErrorMessage(await response.text()) ??
            `The model provider answered with status ${response.status}.`
        );
      return new Response(await response.arrayBuffer(), {
        status: response.status,
        headers: responseHeaders(response.headers),
      });
    } catch (error) {
      console.error("Decision Endpoint upstream request failed.", error);
      return decisionErrorResponse(
        502,
        "The model provider could not be reached."
      );
    }
  };
}
