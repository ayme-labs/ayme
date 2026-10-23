import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decisionEndpoint } from "../infrastructure/decisionEndpoint";
import {
  DecisionEndpointError,
  type DecisionEndpointErrorCode,
  type DecisionFailure,
  type DecisionRequest,
  isRetryableDecisionFailure,
  readDecisionResponse,
} from "./decisionWire";
import { AymeError } from "../../shared";
import { createDecisionEndpoint } from "../infrastructure/decisionEndpointHandler";

const request: DecisionRequest = {
  state: { goal: "archive item" },
  questions: {
    operation: { type: "choice", instructions: "Pick one.", criteria: {} },
  },
};

const providerUrl = "https://api.typesafe.ai/v1/systemone";

/**
 * The browser's `fetch` reaches the real handler mounted at `/api/decisions`;
 * the handler's own `fetch` reaches `provider`. Any other path is a route
 * nothing serves, answered as a dev server does: 404 with an empty body.
 */
function wire(provider: (body: unknown) => Response) {
  const handler = createDecisionEndpoint({
    provider: "typesafe",
    apiKey: "secret",
    authorize: () => {},
  });
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === providerUrl)
      return provider(JSON.parse(String(init?.body)) as unknown);
    if (url === "/api/decisions")
      return handler(new Request(`http://localhost${url}`, init));
    return new Response("", { status: 404, statusText: "Not Found" });
  });
}

async function failure(
  promise: Promise<unknown>
): Promise<DecisionEndpointError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(DecisionEndpointError);
  return error as DecisionEndpointError;
}

describe("the Decision Endpoint wire contract, client against handler", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      wire(() => Response.json({ model: "jev-1.13.0", answers: { a: 1 } }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the provider's decision response", async () => {
    await expect(decisionEndpoint("/api/decisions")(request)).resolves.toEqual({
      model: "jev-1.13.0",
      answers: { a: 1 },
    });
  });

  it("reports a provider rejection as rejected, with the provider's status and message", async () => {
    vi.stubGlobal(
      "fetch",
      wire(() =>
        Response.json(
          { detail: { message: "Unknown model." } },
          { status: 404 }
        )
      )
    );
    const error = await failure(decisionEndpoint("/api/decisions")(request));
    expect(error).toMatchObject({
      name: "DecisionEndpointError",
      kind: "runtime",
      code: "rejected",
      status: 404,
      message:
        "The Decision Endpoint /api/decisions answered 404 The model provider said: Unknown model.",
    });
    expect(error).toBeInstanceOf(AymeError);
  });

  it("states a provider's Retry-After in the message of a rate limit, which is not retryable", async () => {
    vi.stubGlobal(
      "fetch",
      wire(() =>
        Response.json(
          { error: { message: "Rate limited." } },
          { status: 429, headers: { "Retry-After": "20" } }
        )
      )
    );
    const error = await failure(decisionEndpoint("/api/decisions")(request));
    expect(error).toMatchObject({
      code: "rejected",
      status: 429,
      retryable: false,
      message:
        "The Decision Endpoint /api/decisions answered 429 The model provider said: Rate limited (Retry-After: 20 s)",
    });
  });

  it("reports a provider outage as rejected with a 5xx", async () => {
    vi.stubGlobal(
      "fetch",
      wire(() => {
        throw new TypeError("fetch failed");
      })
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = await failure(decisionEndpoint("/api/decisions")(request));
    expect(error).toMatchObject({ code: "rejected", status: 502 });
  });

  it("reports a route nothing serves as not mounted", async () => {
    const error = await failure(decisionEndpoint("/api/missing")(request));
    expect(error).toMatchObject({
      code: "not-mounted",
      status: 404,
      message:
        "No Decision Endpoint is mounted at /api/missing: it answered 404 Not Found",
    });
  });

  it("reports a successful answer that is not a decision response as malformed", async () => {
    vi.stubGlobal(
      "fetch",
      wire(() => Response.json({ model: "jev-1.13.0" }))
    );
    const error = await failure(decisionEndpoint("/api/decisions")(request));
    expect(error).toMatchObject({
      code: "malformed",
      message:
        "The Decision Endpoint /api/decisions answered 200 with a body that is not a decision response",
    });
    expect(error.status).toBeUndefined();
  });
});

describe("readDecisionResponse", () => {
  const errorBody = (error: string) => JSON.stringify({ error });

  it.each([
    [404, "", "not-mounted", false],
    [404, errorBody("Unknown model."), "rejected", false],
    [
      400,
      errorBody("The request body must include state and questions."),
      "rejected",
      false,
    ],
    [408, errorBody("Timed out."), "rejected", true],
    [429, errorBody("Rate limit reached."), "rejected", false],
    [500, "", "rejected", true],
    [
      502,
      errorBody("The model provider could not be reached."),
      "rejected",
      true,
    ],
    [501, errorBody("Not implemented."), "rejected", false],
    [503, "Service Unavailable", "rejected", true],
  ] as const)(
    "classifies a %i (body %j) as %s, retryable: %s",
    async (status, body, code, retryable) => {
      const error = await failure(
        readDecisionResponse("/api/decisions", new Response(body, { status }))
      );
      expect(error).toMatchObject({ code, status, retryable });
    }
  );

  it.each([
    ["20", "Rate limit reached (Retry-After: 20 s)"],
    [
      new Date(Date.now() + 30_000).toUTCString(),
      /Rate limit reached \(Retry-After: (29|30) s\)$/,
    ],
    ["soon", "Rate limit reached."],
  ])(
    "states a Retry-After of %j in the message",
    async (retryAfter, ending) => {
      const error = await failure(
        readDecisionResponse(
          "/api/decisions",
          new Response(errorBody("Rate limit reached."), {
            status: 429,
            headers: { "Retry-After": retryAfter },
          })
        )
      );
      expect(error.message).toMatch(
        typeof ending === "string"
          ? `The Decision Endpoint /api/decisions answered 429 ${ending}`
          : ending
      );
    }
  );

  it("classifies a 2xx that is not a decision response as malformed, not retryable", async () => {
    const error = await failure(
      readDecisionResponse("/api/decisions", Response.json({ model: "jev" }))
    );
    expect(error).toMatchObject({ code: "malformed", retryable: false });
    expect(error.status).toBeUndefined();
  });
});

describe("whether a decision failure is worth a retry", () => {
  const endpoint = (code: DecisionEndpointErrorCode, status?: number) =>
    ({
      kind: "endpoint",
      error: new DecisionEndpointError("The endpoint failed", { code, status }),
    }) as const;

  it.each<[string, DecisionFailure, boolean]>([
    ["a rejected 503", endpoint("rejected", 503), true],
    ["a rejected 429", endpoint("rejected", 429), false],
    ["a malformed answer", endpoint("malformed"), false],
    ["a thrown error", { kind: "thrown" }, true],
    ["an invalid answer", { kind: "invalid" }, false],
    ["an unknown choice", { kind: "unknown-choice" }, false],
    ["too many operations", { kind: "too-many-operations" }, false],
  ])("%s is retryable: %s", (_, failure, retryable) => {
    expect(isRetryableDecisionFailure(failure)).toBe(retryable);
  });
});
