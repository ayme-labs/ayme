import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decisionEndpoint } from "./decisionEndpoint";
import { DecisionEndpointError, type DecisionRequest } from "./decisionWire";
import { AymeError } from "./errors";
import { createDecisionEndpoint } from "./server";

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
        "The Decision Endpoint /api/decisions answered 404 Unknown model.",
    });
    expect(error).toBeInstanceOf(AymeError);
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
      message: "The Decision Endpoint returned an invalid response.",
    });
    expect(error.status).toBeUndefined();
  });
});
