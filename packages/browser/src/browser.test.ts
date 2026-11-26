import { Effect, Exit, Fiber, Scope } from "effect";
import { expect, it } from "vitest";

import {
  browser,
  browserUnavailable,
  type BrowserRequest,
  type ProjectPlaywright,
} from "./index";

/** A stand-in for the project's Playwright: its Chromium starts or joins a
 * browser that says what it was asked, unless `refuses` says why not. With
 * `held`, it answers only once the test calls `answer`. */
function standIn({ refuses, held }: { refuses?: string; held?: true } = {}) {
  const asked: unknown[] = [];
  const made = { closed: 0 };
  let release!: () => void;
  const answered = held
    ? new Promise<void>((resolve) => (release = resolve))
    : Promise.resolve();
  const answer = async (call: unknown) => {
    asked.push(call);
    await answered;
    if (refuses) throw new Error(refuses);
    return {
      close: async () => {
        made.closed += 1;
        // A browser the person already closed has nothing left to close.
        throw new Error("Target closed");
      },
    };
  };
  const found = {
    version: "1.64.0",
    playwright: {
      chromium: {
        launch: (options: unknown) => answer({ launch: options }),
        launchPersistentContext: async (folder: string, options: unknown) => {
          const browser = await answer({
            launchPersistentContext: [folder, options],
          });
          return { browser: () => browser };
        },
        connectOverCDP: (address: string, options: unknown) =>
          answer({ connectOverCDP: [address, options] }),
      },
    },
  } as unknown as ProjectPlaywright;
  return { found, asked, made, answer: () => release() };
}

/** Whether `promise` is still pending once everything ready to run ran. */
async function pending(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(() => (settled = true));
  for (let turn = 0; turn < 20; turn++)
    await new Promise((resolve) => setImmediate(resolve));
  return !settled;
}

/** Gets the browser in a scope of its own, and the means to close it. */
async function got(found: ProjectPlaywright, request: BrowserRequest) {
  const scope = await Effect.runPromise(Scope.make());
  const got = await Effect.runPromise(
    browser(found, request).pipe(Scope.provide(scope))
  );
  return {
    got,
    release: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
}

const failure = (found: ProjectPlaywright, request: BrowserRequest) =>
  Effect.runPromise(Effect.flip(Effect.scoped(browser(found, request))));

it("starts Chromium headed, and leaves the terminal's signals to its caller", async () => {
  const { found, asked } = standIn();

  const { got: started } = await got(found, { open: { headed: true } });

  expect(asked).toEqual([
    {
      launch: {
        headless: false,
        args: [],
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
      },
    },
  ]);
  expect(started.opened).toBe(true);
});

it("starts Chromium headless, with its DevTools protocol on the debug port it is given", async () => {
  const { found, asked } = standIn();

  await got(found, { open: { headed: false, debugPort: 9333 } });

  expect(asked).toEqual([
    {
      launch: expect.objectContaining({
        headless: true,
        args: ["--remote-debugging-port=9333"],
      }),
    },
  ]);
});

it("starts Chromium on a profile in the folder it is given, emulating no viewport of its own", async () => {
  const { found, asked } = standIn();

  const { got: started } = await got(found, {
    open: { headed: false, profile: "/tmp/ayme-profile" },
  });

  expect(asked).toEqual([
    {
      launchPersistentContext: [
        "/tmp/ayme-profile",
        {
          headless: true,
          args: [],
          viewport: null,
          handleSIGINT: false,
          handleSIGTERM: false,
          handleSIGHUP: false,
        },
      ],
    },
  ]);
  expect(started.opened).toBe(true);
});

it("joins the browser at the address it is given, without Playwright's defaults", async () => {
  const { found, asked } = standIn();

  const { got: joined } = await got(found, {
    join: { cdp: "http://127.0.0.1:9222" },
  });

  expect(asked).toEqual([
    { connectOverCDP: ["http://127.0.0.1:9222", { noDefaults: true }] },
  ]);
  expect(joined.opened).toBe(false);
});

it.each<BrowserRequest>([
  { open: { headed: true } },
  { open: { headed: true, profile: "/tmp/ayme-profile" } },
  { join: { cdp: "http://127.0.0.1:9222" } },
])(
  "releases the browser when its scope closes, once, even when it is gone already: %j",
  async (request) => {
    const { found, made } = standIn();
    const { release } = await got(found, request);
    expect(made.closed).toBe(0);

    await release();

    expect(made.closed).toBe(1);
  }
);

it("fails, saying why, when Chromium does not start", async () => {
  const { found } = standIn({ refuses: "Executable doesn't exist" });

  expect(await failure(found, { open: { headed: true } })).toMatchObject({
    kind: "browser did not start",
    message: "Playwright could not open Chromium. Executable doesn't exist",
  });
});

it("fails, naming the address, when the browser there cannot be joined", async () => {
  const { found } = standIn({ refuses: "connect ECONNREFUSED" });

  expect(
    await failure(found, { join: { cdp: "http://127.0.0.1:9222" } })
  ).toMatchObject({
    kind: "address unreachable",
    message:
      "Playwright could not connect to the browser at http://127.0.0.1:9222. connect ECONNREFUSED",
  });
});

it("says whether a join that failed waited until Playwright's timeout", async () => {
  const timeout = Object.assign(
    new Error("browserType.connectOverCDP: Timeout 30000ms exceeded."),
    { name: "TimeoutError" }
  );
  const join = { join: { cdp: "http://127.0.0.1:9222" } };

  expect(browserUnavailable(join, timeout)).toMatchObject({
    kind: "address unreachable",
    timedOut: true,
  });
  expect(
    browserUnavailable(join, new Error("connect ECONNREFUSED"))
  ).toMatchObject({ timedOut: false });
});

it("says why a browser is unavailable for a cause that is not an Error", () => {
  expect(browserUnavailable({ open: { headed: true } }, "gone")).toMatchObject({
    kind: "browser did not start",
    message: "Playwright could not open Chromium. gone",
  });
});

it.each<BrowserRequest>([
  { open: { headed: true } },
  { open: { headed: true, profile: "/tmp/ayme-profile" } },
  { join: { cdp: "http://127.0.0.1:9222" } },
])(
  "getting a browser that does not answer yet stops at once when interrupted, and a browser got after that is let go: %j",
  async (request) => {
    const { found, asked, made, answer } = standIn({ held: true });
    const getting = Effect.runFork(Effect.scoped(browser(found, request)));
    await pending(Promise.resolve());
    expect(asked).toHaveLength(1);

    const interrupted = Effect.runPromise(Fiber.interrupt(getting));

    expect(await pending(interrupted)).toBe(false);
    expect(made.closed).toBe(0);
    answer();
    await expect.poll(() => made.closed).toBe(1);
  }
);
