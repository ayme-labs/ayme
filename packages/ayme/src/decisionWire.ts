/**
 * The Decision Endpoint's wire contract: the request and response the browser
 * and the handler exchange, the error body the handler answers a failure
 * with, and how the browser reads a failure. `decisionEndpoint` (the fetch
 * client) and `createDecisionEndpoint` (the handler) are its two adapters.
 */
import { AymeError } from "./errors";

export type DecisionState = string | Record<string, unknown> | unknown[];

export type DecisionQuestions = Record<string, unknown>;

export type DecisionRequest = {
  state: DecisionState;
  questions: DecisionQuestions;
};

export type DecisionResponse = {
  model: string;
  answers: Record<string, unknown>;
  [key: string]: unknown;
};

/** The body of every failure the handler writes. */
export type DecisionErrorBody = { error: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isDecisionRequest(value: unknown): value is DecisionRequest {
  return (
    isRecord(value) &&
    (typeof value.state === "string" ||
      (value.state !== null && typeof value.state === "object")) &&
    isRecord(value.questions)
  );
}

export function isDecisionResponse(value: unknown): value is DecisionResponse {
  return (
    isRecord(value) &&
    typeof value.model === "string" &&
    isRecord(value.answers)
  );
}

/** A failure answered as the handler answers one: `{ error }` as JSON. */
export function decisionErrorResponse(status: number, error: string): Response {
  const body: DecisionErrorBody = { error };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Why a Decision Endpoint call failed.
 * `not-mounted`: a 404 without an error body; nothing serves the route, such
 * as a dev server started without a model key.
 * `rejected`: any other non-2xx; the handler, `authorize` or the provider
 * refused the request, or the provider could not be reached.
 * `malformed`: a 2xx whose body is not a decision response.
 */
export type DecisionEndpointErrorCode =
  "not-mounted" | "rejected" | "malformed";

/** A Decision Endpoint call failed; `code` says why. */
export class DecisionEndpointError extends AymeError {
  override readonly name = "DecisionEndpointError";
  readonly kind = "runtime";
  readonly code: DecisionEndpointErrorCode;
  /** The HTTP status, for `not-mounted` and `rejected`. */
  readonly status?: number;

  constructor(
    message: string,
    options: ErrorOptions & { code: DecisionEndpointErrorCode; status?: number }
  ) {
    super(message, options);
    this.code = options.code;
    this.status = options.status;
  }
}

function errorBodyMessage(text: string): string | undefined {
  try {
    const body: unknown = JSON.parse(text);
    if (isRecord(body) && typeof body.error === "string") return body.error;
  } catch {
    // Not JSON: no error body.
  }
  return undefined;
}

/** Read the endpoint's answer: the decision response, or the failure it is. */
export async function readDecisionResponse(
  url: string,
  response: Response
): Promise<DecisionResponse> {
  const text = await response.text();
  const { status, statusText } = response;
  if (!response.ok) {
    const error = errorBodyMessage(text);
    if (status === 404 && error === undefined)
      throw new DecisionEndpointError(
        `No Decision Endpoint is mounted at ${url}: it answered 404${statusText ? ` ${statusText}` : ""}`,
        { code: "not-mounted", status }
      );
    const detail = (error ?? text).trim() || statusText;
    throw new DecisionEndpointError(
      `The Decision Endpoint ${url} answered ${status}${detail ? ` ${detail}` : ""}`,
      { code: "rejected", status }
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (!isDecisionResponse(body))
    throw new DecisionEndpointError(
      "The Decision Endpoint returned an invalid response.",
      { code: "malformed" }
    );
  return body;
}
