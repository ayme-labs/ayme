import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDecisionEndpoint } from "./server";

const validBody = {
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
      createDecisionEndpoint({
        provider: "openrouter",
        apiKey: "secret",
        authorize,
      })
    ).toThrow("createDecisionEndpoint must run on the server.");
  });

  it("rejects unauthorized requests with the authorize response", async () => {
    authorize.mockImplementation(() => {
      throw new Response(JSON.stringify({ error: "Forbidden." }), {
        status: 403,
      });
    });
    const handler = createDecisionEndpoint({
      provider: "openrouter",
      apiKey: "secret",
      authorize,
    });
    const response = await handler(jsonRequest(validBody));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-POST requests with 405", async () => {
    const handler = createDecisionEndpoint({
      provider: "openrouter",
      apiKey: "secret",
      authorize,
    });
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
    const handler = createDecisionEndpoint({
      provider: "openrouter",
      apiKey: "secret",
      authorize,
    });
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

  it("stops reading streaming bodies once they exceed 1 MB", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
        setTimeout(() => {
          if (!cancelled) controller.close();
        }, 20);
      },
      cancel() {
        cancelled = true;
      },
    });
    const handler = createDecisionEndpoint({
      provider: "openrouter",
      apiKey: "secret",
      authorize,
    });
    const response = await handler(
      new Request("http://localhost/decisions", {
        method: "POST",
        body,
        duplex: "half",
      } as RequestInit)
    );
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(await response.json()).toEqual({
      error: "The request body must be at most 1 MB.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-JSON bodies with 400", async () => {
    const handler = createDecisionEndpoint({
      provider: "openrouter",
      apiKey: "secret",
      authorize,
    });
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
    const handler = createDecisionEndpoint({
      provider: "openrouter",
      apiKey: "secret",
      authorize,
    });
    const response = await handler(jsonRequest({ state: "a page" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "The request body must include state and questions.",
    });
  });

  it.each([
    { ...validBody, state: null },
    { ...validBody, questions: [] },
  ])("rejects invalid required field types with 400", async (body) => {
    const handler = createDecisionEndpoint({
      provider: "openrouter",
      apiKey: "secret",
      authorize,
    });
    const response = await handler(jsonRequest(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "The request body must include state and questions.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the provider is not openrouter or typesafe", () => {
    expect(() =>
      createDecisionEndpoint({
        provider: "openai" as "openrouter",
        apiKey: "secret",
        authorize,
      })
    ).toThrow('The provider must be "openrouter" or "typesafe".');
  });

  it.each([
    {
      provider: "openrouter" as const,
      upstreamUrl: "https://openrouter.ai/api/v1/systemone",
      model: "typesafe/jev-1.13",
    },
    {
      provider: "typesafe" as const,
      upstreamUrl: "https://api.typesafe.ai/v1/systemone",
      model: "jev-1.13.0",
    },
  ])(
    "forwards to $provider with its Jev model id and the key, and no incoming headers",
    async ({ provider, upstreamUrl, model }) => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ model, answers: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
      const handler = createDecisionEndpoint({
        provider,
        apiKey: "secret-key",
        authorize,
      });
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
      expect(JSON.parse(String(init?.body))).toEqual({ model, ...validBody });
    }
  );

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
    const handler = createDecisionEndpoint({
      provider: "openrouter",
      apiKey: "secret",
      authorize,
    });
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
    const handler = createDecisionEndpoint({
      provider: "openrouter",
      apiKey: "secret",
      authorize,
    });
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
    const handler = createDecisionEndpoint({
      provider: "openrouter",
      apiKey: "secret",
      authorize,
    });
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
    const handler = createDecisionEndpoint({
      provider: "openrouter",
      apiKey: "secret",
      authorize,
    });
    const response = await handler(jsonRequest(validBody));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "The model provider could not be reached.",
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
