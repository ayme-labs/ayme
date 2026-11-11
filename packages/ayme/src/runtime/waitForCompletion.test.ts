import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COMPLETION_REQUESTS_DEADLINE_MS,
  COMPLETION_SETTLE_MS,
  waitForCompletion,
  type CompletionRequest,
} from "./waitForCompletion";

/** A page whose requests the test starts and whose timeouts run on the fake clock. */
function fakePage() {
  const listeners = new Set<(request: CompletionRequest) => void>();
  return {
    on: (_: "request", listener: (request: CompletionRequest) => void) =>
      listeners.add(listener),
    off: (_: "request", listener: (request: CompletionRequest) => void) =>
      listeners.delete(listener),
    waitForTimeout: (timeout: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, timeout)),
    start(request: CompletionRequest) {
      for (const listener of listeners) listener(request);
    },
    listening: () => listeners.size > 0,
  };
}

/** A request whose response finishes `ms` from now, or never. */
function request(ms?: number, resourceType = "fetch"): CompletionRequest {
  const finished = new Promise<null>((resolve) => {
    if (ms !== undefined) setTimeout(() => resolve(null), ms);
  });
  return {
    resourceType: () => resourceType,
    response: async () => ({ finished: () => finished }),
  };
}

/** How long `wait` takes on the fake clock. */
async function elapsed(wait: Promise<unknown>): Promise<number> {
  const startedAt = Date.now();
  let done = false;
  void wait.then(() => (done = true));
  while (!done) await vi.advanceTimersByTimeAsync(10);
  return Date.now() - startedAt;
}

describe("the wait Playwright's tools take after an action", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits the settle time alone after an action that started no request, and stops listening", async () => {
    const page = fakePage();
    const wait = waitForCompletion(page, async () => "done");
    expect(await elapsed(wait)).toBe(COMPLETION_SETTLE_MS);
    expect(await wait).toBe("done");
    expect(page.listening()).toBe(false);
  });

  it("waits for a request the action started to finish, then the settle time once more", async () => {
    const page = fakePage();
    const wait = waitForCompletion(page, async () => {
      page.start(request(1_200));
    });
    expect(await elapsed(wait)).toBe(1_200 + COMPLETION_SETTLE_MS);
  });

  it("records a request started within the settle time after the action", async () => {
    const page = fakePage();
    const wait = waitForCompletion(page, async () => {
      setTimeout(() => page.start(request(1_000)), 300);
    });
    expect(await elapsed(wait)).toBe(300 + 1_000 + COMPLETION_SETTLE_MS);
  });

  it("does not wait for a request started after the settle time", async () => {
    const page = fakePage();
    const wait = waitForCompletion(page, async () => {
      setTimeout(() => page.start(request(3_000)), COMPLETION_SETTLE_MS + 100);
    });
    expect(await elapsed(wait)).toBe(COMPLETION_SETTLE_MS);
  });

  it("gives up on a request that never finishes at the deadline, counted from the settle time's end", async () => {
    const page = fakePage();
    const wait = waitForCompletion(page, async () => {
      page.start(request());
    });
    expect(await elapsed(wait)).toBe(
      COMPLETION_SETTLE_MS +
        COMPLETION_REQUESTS_DEADLINE_MS +
        COMPLETION_SETTLE_MS
    );
  });

  it("waits only for the response of a request that is neither a document, a stylesheet, a script, an XHR nor a fetch", async () => {
    const page = fakePage();
    const wait = waitForCompletion(page, async () => {
      page.start(request(undefined, "image"));
    });
    expect(await elapsed(wait)).toBe(2 * COMPLETION_SETTLE_MS);
  });

  it("takes a failed request, which has no response, as finished", async () => {
    const page = fakePage();
    const wait = waitForCompletion(page, async () => {
      page.start({ resourceType: () => "xhr", response: async () => null });
    });
    expect(await elapsed(wait)).toBe(2 * COMPLETION_SETTLE_MS);
  });

  it("returns at once, without listening on, when the result ended the document", async () => {
    const page = fakePage();
    const wait = waitForCompletion(
      page,
      async () => ({ loading: "http://app/next" }),
      (result) => result.loading !== undefined
    );
    expect(await elapsed(wait)).toBeLessThanOrEqual(10);
    expect(page.listening()).toBe(false);
  });

  it("stops listening and rethrows when the action fails", async () => {
    const page = fakePage();
    await expect(
      waitForCompletion(page, async () => {
        throw new Error("refused");
      })
    ).rejects.toThrow("refused");
    expect(page.listening()).toBe(false);
  });
});
