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

/**
 * Every way obtaining a usable decision can fail.
 * `endpoint`: a Decision Endpoint call failed, as its `code` and `status` say.
 * `thrown`: any other error from the decision function, such as a network
 * failure.
 * `invalid`: an answer the caller could not read.
 * `unknown-choice`: an answer naming an option the caller did not offer.
 */
export type DecisionFailure =
  | { kind: "endpoint"; code: DecisionEndpointErrorCode; status?: number }
  | { kind: "thrown" }
  | { kind: "invalid" }
  | { kind: "unknown-choice" };

/**
 * Whether asking again can help: the endpoint or its provider failed, timed
 * out or was rate limited (a `rejected` 5xx, 408 or 429), or the call failed
 * some other way. A missing endpoint, a refusal, a malformed answer or one the
 * caller cannot use comes back the same.
 */
export function isRetryableDecisionFailure(failure: DecisionFailure): boolean {
  switch (failure.kind) {
    case "endpoint": {
      const status = failure.status ?? 0;
      return (
        failure.code === "rejected" &&
        (status >= 500 || status === 408 || status === 429)
      );
    }
    case "thrown":
      return true;
    case "invalid":
    case "unknown-choice":
      return false;
  }
}

/** A Decision Endpoint call failed; `code` says why. */
export class DecisionEndpointError extends AymeError {
  override readonly name = "DecisionEndpointError";
  readonly kind = "runtime";
  readonly code: DecisionEndpointErrorCode;
  /** The HTTP status, for `not-mounted` and `rejected`. */
  readonly status?: number;
  /** Whether a retry can help: a `rejected` 5xx, 408 or 429. */
  readonly retryable: boolean;

  constructor(
    message: string,
    options: ErrorOptions & { code: DecisionEndpointErrorCode; status?: number }
  ) {
    super(message, options);
    this.code = options.code;
    this.status = options.status;
    this.retryable = isRetryableDecisionFailure({
      kind: "endpoint",
      code: options.code,
      status: options.status,
    });
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
