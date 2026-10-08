import { describe, expect, it, vi } from "vitest";

import { decisionEndpointPrecondition } from "./preconditions.ts";

const baseUrl = "http://localhost:3000";

const answering = (status: number) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));

describe("the Decision Endpoint precondition", () => {
  it("sends an empty decision request, which the endpoint refuses before any model call", async () => {
    const fetchMock = answering(400);
    expect(
      await decisionEndpointPrecondition(baseUrl, fetchMock).check()
    ).toBeNull();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${baseUrl}/api/ayme/decisions`);
    expect(init).toMatchObject({ method: "POST", body: "{}" });
  });

  it("names the missing model key when the endpoint answers 503", async () => {
    const problem = await decisionEndpointPrecondition(
      baseUrl,
      answering(503)
    ).check();
    expect(problem).toContain("no model key");
    expect(problem).toContain("AYME_OPENROUTER_API_KEY");
  });

  it("names any other status", async () => {
    expect(
      await decisionEndpointPrecondition(baseUrl, answering(404)).check()
    ).toContain("HTTP 404");
  });

  it("names an unreachable endpoint", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed"));
    expect(
      await decisionEndpointPrecondition(baseUrl, fetchMock).check()
    ).toContain("not reachable");
  });
});
