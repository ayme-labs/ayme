import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decisionEndpoint } from "./decisionEndpoint";
import type { DecisionRequest } from "./decisionWire";

const request: DecisionRequest = {
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

  it.each([
    ["a Headers instance", new Headers({ "Content-Type": "application/json" })],
    ["a lower-case object key", { "content-type": "application/json" }],
    [
      "two casings in one object",
      {
        "Content-Type": "application/json",
        "content-type": "application/json",
      },
    ],
    [
      "two casings in a tuple array",
      [
        ["Content-Type", "application/json"],
        ["content-type", "application/json"],
      ] as [string, string][],
    ],
    [
      "a tuple array",
      [["CONTENT-TYPE", "application/json"]] as [string, string][],
    ],
  ])("sends one content type when headers set it as %s", async (_, init) => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ model: "typesafe/jev-1.13", answers: {} }))
    );
    await decisionEndpoint("/api/decisions", { headers: init })(request);
    const sent = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(sent.get("content-type")).toBe("application/json");
  });

  it("keeps the caller's content type and other headers", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ model: "typesafe/jev-1.13", answers: {} }))
    );
    await decisionEndpoint("/api/decisions", {
      headers: () =>
        new Headers({
          "content-type": "application/vnd.ayme+json",
          "X-Trace": "1",
        }),
    })(request);
    const sent = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(sent.get("content-type")).toBe("application/vnd.ayme+json");
    expect(sent.get("x-trace")).toBe("1");
  });

  it("throws on non-2xx responses with the status and error text", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Forbidden." }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );
    const decide = decisionEndpoint("/api/decisions");
    await expect(decide(request)).rejects.toMatchObject({
      code: "rejected",
      status: 403,
      message: "The Decision Endpoint /api/decisions answered 403 Forbidden.",
    });
  });

  it("reports a 404 without an error body as no endpoint mounted", async () => {
    fetchMock.mockResolvedValue(
      new Response("", { status: 404, statusText: "Not Found" })
    );
    const decide = decisionEndpoint("/api/decisions");
    await expect(decide(request)).rejects.toMatchObject({
      code: "not-mounted",
      status: 404,
      message:
        "No Decision Endpoint is mounted at /api/decisions: it answered 404 Not Found",
    });
    // Over HTTP/2 there is no status text either.
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    await expect(decide(request)).rejects.toThrow(
      /^No Decision Endpoint is mounted at \/api\/decisions: it answered 404$/
    );
  });

  it("names the URL and status when another error response has no body", async () => {
    fetchMock.mockResolvedValue(
      new Response("", { status: 401, statusText: "Unauthorized" })
    );
    const decide = decisionEndpoint("/api/decisions");
    await expect(decide(request)).rejects.toMatchObject({
      code: "rejected",
      status: 401,
      message: "The Decision Endpoint /api/decisions answered 401 Unauthorized",
    });
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    await expect(decide(request)).rejects.toThrow(
      /^The Decision Endpoint \/api\/decisions answered 401$/
    );
  });

  it("keeps a non-JSON error body as the error text", async () => {
    fetchMock.mockResolvedValue(new Response("Bad gateway\n", { status: 502 }));
    await expect(
      decisionEndpoint("/api/decisions")(request)
    ).rejects.toMatchObject({
      code: "rejected",
      status: 502,
      message: "The Decision Endpoint /api/decisions answered 502 Bad gateway",
    });
  });

  it("names an HTML error page by its status text, not its markup", async () => {
    // Such as a reverse proxy's error page in front of the endpoint.
    const page = `<!DOCTYPE html><html><head><style>${"body{}".repeat(500)}</style></head><body><h1>502 Bad Gateway</h1></body></html>`;
    fetchMock.mockResolvedValue(
      new Response(page, { status: 502, statusText: "Bad Gateway" })
    );
    const decide = decisionEndpoint("/api/decisions");
    await expect(decide(request)).rejects.toMatchObject({
      code: "rejected",
      status: 502,
      message: "The Decision Endpoint /api/decisions answered 502 Bad Gateway",
    });
    fetchMock.mockResolvedValue(new Response(page, { status: 502 }));
    await expect(decide(request)).rejects.toThrow(
      /^The Decision Endpoint \/api\/decisions answered 502$/
    );
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
    await expect(decide(request)).rejects.toMatchObject({
      code: "malformed",
      message:
        "The Decision Endpoint /api/decisions answered 200 with a body that is not a decision response",
    });
  });
});
