import type { DecisionRequest } from "./decisionTypes";

const upstreamUrl = "https://openrouter.ai/api/v1/systemone";
const maxBodyBytes = 1024 * 1024;

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
    "model" in record &&
    "state" in record &&
    "questions" in record &&
    record.questions !== null &&
    typeof record.questions === "object"
  );
}

export function createDecisionEndpoint({
  apiKey,
  authorize,
}: CreateDecisionEndpointOptions): (request: Request) => Promise<Response> {
  if (typeof document !== "undefined")
    throw new Error("createDecisionEndpoint must run on the server.");

  return async (request) => {
    if (request.method !== "POST")
      return jsonError(405, "The request method must be POST.");

    try {
      await authorize(request);
    } catch (error) {
      if (error instanceof Response) return error;
      throw error;
    }

    const bodyBytes = new Uint8Array(await request.arrayBuffer());
    if (bodyBytes.byteLength > maxBodyBytes)
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
        headers: upstream.headers,
      });
    } catch (error) {
      console.error("Decision Endpoint upstream request failed.", error);
      return jsonError(502, "The model provider could not be reached.");
    }
  };
}
