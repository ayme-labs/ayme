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

/**
 * A failure answered as the handler answers one: `{ error }` as JSON, with
 * the provider's `Retry-After` when it sent one.
 */
export function decisionErrorResponse(
  status: number,
  error: string,
  retryAfter?: string | null
): Response {
  const body: DecisionErrorBody = { error };
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (retryAfter) headers["Retry-After"] = retryAfter;
  return new Response(JSON.stringify(body), { status, headers });
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
 * `endpoint`: a Decision Endpoint call failed; the error says why and whether
 * it is `retryable`.
 * `thrown`: any other error from the decision function, such as a network
 * failure.
 * `invalid`: an answer the caller could not read.
 * `unknown-choice`: an answer naming an option the caller did not offer.
 * `too-many-operations`: the page offers more operations than one decision
 * can choose from, so the question is never asked.
 */
export type DecisionFailure =
  | { kind: "endpoint"; error: DecisionEndpointError }
  | { kind: "thrown" }
  | { kind: "invalid" }
  | { kind: "unknown-choice" }
  | { kind: "too-many-operations" };

/**
 * Whether asking again right away can help: the endpoint error says so, and
 * any other error from the decision function can. An answer the caller cannot
 * use, or a question it cannot ask, comes back the same.
 */
export function isRetryableDecisionFailure(failure: DecisionFailure): boolean {
  switch (failure.kind) {
    case "endpoint":
      return failure.error.retryable;
    case "thrown":
      return true;
    case "invalid":
    case "unknown-choice":
    case "too-many-operations":
      return false;
  }
}

/**
 * Whether asking the endpoint again right away can help: the endpoint or its
 * provider failed or timed out (a `rejected` 5xx other than 501, or 408). A
 * rate limit (429), a method the endpoint does not implement (501), a missing
 * endpoint, a refusal or a malformed answer comes back the same.
 */
function isRetryableEndpointFailure(
  code: DecisionEndpointErrorCode,
  status = 0
): boolean {
  return (
    code === "rejected" && ((status >= 500 && status !== 501) || status === 408)
  );
}

/** A Decision Endpoint call failed; `code` says why. */
export class DecisionEndpointError extends AymeError {
  override readonly name = "DecisionEndpointError";
  readonly kind = "runtime";
  readonly code: DecisionEndpointErrorCode;
  /** The HTTP status, for `not-mounted` and `rejected`. */
  readonly status?: number;
  /** Whether asking again right away can help: a `rejected` 5xx other than 501, or 408. */
  readonly retryable: boolean;

  constructor(
    message: string,
    options: ErrorOptions & { code: DecisionEndpointErrorCode; status?: number }
  ) {
    super(message, options);
    this.code = options.code;
    this.status = options.status;
    this.retryable = isRetryableEndpointFailure(options.code, options.status);
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

/**
 * A `Retry-After` value as whole seconds from now: delay-seconds as given, an
 * HTTP date counted from now. Anything else is no wait.
 */
function retryAfterSeconds(value: string | null): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
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
    // A markup body, such as a proxy's error page, is no text to show.
    const plain = text.trim().startsWith("<") ? "" : text;
    let detail = (error ?? plain).trim() || statusText;
    const wait = retryAfterSeconds(response.headers.get("Retry-After"));
    if (wait !== undefined)
      detail = `${detail.replace(/\.$/, "")} (Retry-After: ${wait} s)`.trim();
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
      `The Decision Endpoint ${url} answered ${status} with a body that is not a decision response`,
      { code: "malformed" }
    );
  return body;
}
