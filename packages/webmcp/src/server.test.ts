import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDecisionEndpoint } from "./server";

const upstreamUrl = "https://openrouter.ai/api/v1/systemone";
const validBody = {
  model: "typesafe/jev-1.13",
  state: { goal: "archive item" },
  questions: {
    operation: { type: "choice", instructions: "Pick one.", criteria: {} },
  },
};

function jsonRequest(
  body: unknown,
  init: RequestInit & { url?: string } = {}
): Request {
  const { url = "http://localhost/decisions", headers, ...rest } = init;
  return new Request(url, {
    method: "POST",
    ...rest,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("createDecisionEndpoint", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const authorize = vi.fn<(request: Request) => void | Promise<void>>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    authorize.mockReset();
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when a document exists", () => {
    vi.stubGlobal("document", {});
    expect(() =>
      createDecisionEndpoint({ apiKey: "secret", authorize })
    ).toThrow("createDecisionEndpoint must run on the server.");
  });

  it("rejects unauthorized requests with the authorize response", async () => {
    authorize.mockImplementation(() => {
      throw new Response(JSON.stringify({ error: "Forbidden." }), {
        status: 403,
      });
    });
    const handler = createDecisionEndpoint({ apiKey: "secret", authorize });
    const response = await handler(jsonRequest(validBody));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-POST requests with 405", async () => {
    const handler = createDecisionEndpoint({ apiKey: "secret", authorize });
    const response = await handler(
      new Request("http://localhost/decisions", { method: "GET" })
    );
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({
      error: "The request method must be POST.",
    });
    expect(authorize).not.toHaveBeenCalled();
  });

  it("rejects bodies over 1 MB with 413", async () => {
    const handler = createDecisionEndpoint({ apiKey: "secret", authorize });
    const response = await handler(
      new Request("http://localhost/decisions", {
        method: "POST",
        body: "x".repeat(1024 * 1024 + 1),
      })
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: "The request body must be at most 1 MB.",
    });
  });

  it("cancels a streaming body as soon as it exceeds 1 MB", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
      },
      cancel,
    });
    const handler = createDecisionEndpoint({ apiKey: "secret", authorize });
    const response = await handler(
      new Request("http://localhost/decisions", {
        method: "POST",
        body,
        duplex: "half",
      } as RequestInit)
    );
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-JSON bodies with 400", async () => {
    const handler = createDecisionEndpoint({ apiKey: "secret", authorize });
    const response = await handler(
      new Request("http://localhost/decisions", {
        method: "POST",
        body: "not json",
      })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "The request body must be valid JSON.",
    });
  });

  it("rejects bodies missing required fields with 400", async () => {
    const handler = createDecisionEndpoint({ apiKey: "secret", authorize });
    const response = await handler(jsonRequest({ model: "typesafe/jev-1.13" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "The request body must include model, state, and questions.",
    });
  });

  it.each([
    { ...validBody, model: null },
    { ...validBody, state: null },
    { ...validBody, questions: [] },
  ])("rejects invalid required field types with 400", async (body) => {
    const handler = createDecisionEndpoint({ apiKey: "secret", authorize });
    const response = await handler(jsonRequest(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "The request body must include model, state, and questions.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects models outside typesafe/jev-* with 400", async () => {
    const handler = createDecisionEndpoint({ apiKey: "secret", authorize });
    const response = await handler(
      jsonRequest({ ...validBody, model: "openai/gpt-4" })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "The model must be a typesafe/jev-* System One model.",
    });
  });

  it("forwards no incoming headers and adds the key for upstream requests", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ model: "typesafe/jev-1.13", answers: {} }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    const handler = createDecisionEndpoint({ apiKey: "secret-key", authorize });
    const response = await handler(
      jsonRequest(validBody, {
        headers: {
          Cookie: "session=abc",
          "X-Custom": "keep-out",
        },
      })
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(upstreamUrl);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers)).toEqual(
      new Headers({
        Authorization: "Bearer secret-key",
        "Content-Type": "application/json",
      })
    );
    expect(JSON.parse(String(init?.body))).toEqual(validBody);
  });

  it("passes upstream success responses through unchanged", async () => {
    const upstreamBody = {
      model: "typesafe/jev-1.13",
      answers: { operation: { type: "choice", choice: "none" } },
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(upstreamBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const handler = createDecisionEndpoint({ apiKey: "secret", authorize });
    const response = await handler(jsonRequest(validBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(upstreamBody);
  });

  it("passes upstream error responses through unchanged", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Rate limited." }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      })
    );
    const handler = createDecisionEndpoint({ apiKey: "secret", authorize });
    const response = await handler(jsonRequest(validBody));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Rate limited." });
  });

  it("removes compressed representation and hop-by-hop response headers", async () => {
    const decodedBody = JSON.stringify({
      model: "typesafe/jev-1.13",
      answers: {},
    });
    fetchMock.mockResolvedValue(
      new Response(decodedBody, {
        status: 200,
        headers: {
          Connection: "keep-alive, x-upstream-hop",
          "Content-Encoding": "gzip",
          "Content-Length": "20",
          "Content-Type": "application/json",
          "Set-Cookie": "session=secret",
          "X-End-To-End": "preserved",
          "X-Upstream-Hop": "removed",
        },
      })
    );
    const handler = createDecisionEndpoint({ apiKey: "secret", authorize });
    const response = await handler(jsonRequest(validBody));
    expect(await response.text()).toBe(decodedBody);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("connection")).toBeNull();
    expect(response.headers.get("x-upstream-hop")).toBeNull();
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("x-end-to-end")).toBe("preserved");
  });

  it("returns 502 when the upstream cannot be reached", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error("network down"));
    const handler = createDecisionEndpoint({ apiKey: "secret", authorize });
    const response = await handler(jsonRequest(validBody));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "The model provider could not be reached.",
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
