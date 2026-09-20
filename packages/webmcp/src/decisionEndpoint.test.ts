import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decisionEndpoint } from "./decisionEndpoint";
import type { DecisionRequest } from "./decisionTypes";

const request: DecisionRequest = {
  model: "typesafe/jev-1.13",
  state: { goal: "archive item" },
  questions: {
    operation: { type: "choice", instructions: "Pick one.", criteria: {} },
  },
};

describe("decisionEndpoint", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the decision request and returns the response body", async () => {
    const responseBody = {
      model: "typesafe/jev-1.13",
      answers: { operation: { type: "choice", choice: "none" } },
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const decide = decisionEndpoint("/api/decisions");
    await expect(decide(request)).resolves.toEqual(responseBody);
    expect(fetchMock).toHaveBeenCalledWith("/api/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(request),
    });
  });

  it("resolves function headers and passes credentials", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ model: "typesafe/jev-1.13", answers: {} }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    const decide = decisionEndpoint("/api/decisions", {
      headers: async () => ({ "X-Trace": "1" }),
      credentials: "include",
    });
    await decide(request);
    expect(fetchMock).toHaveBeenCalledWith("/api/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Trace": "1" },
      credentials: "include",
      body: JSON.stringify(request),
    });
  });

  it("throws on non-2xx responses with the status and error text", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Forbidden." }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );
    const decide = decisionEndpoint("/api/decisions");
    await expect(decide(request)).rejects.toThrow("403 Forbidden.");
  });

  it.each([
    JSON.stringify(null),
    JSON.stringify([]),
    JSON.stringify({ model: 1, answers: {} }),
    JSON.stringify({ model: "typesafe/jev-1.13", answers: null }),
    JSON.stringify({ model: "typesafe/jev-1.13", answers: [] }),
    "not json",
  ])("rejects invalid successful response bodies", async (body) => {
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));
    const decide = decisionEndpoint("/api/decisions");
    await expect(decide(request)).rejects.toThrow(
      "The Decision Endpoint returned an invalid response."
    );
  });
});
