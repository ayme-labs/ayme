import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, onTestFinished } from "vitest";

import {
  handedOver,
  pageTargets,
  readTabOrder,
  tabListAddress,
} from "./tabList";

it.each([
  ["http://127.0.0.1:9222", "http://127.0.0.1:9222/json/list"],
  ["http://127.0.0.1:9222/", "http://127.0.0.1:9222/json/list"],
  [
    "ws://127.0.0.1:9222/devtools/browser/5e0c-41",
    "http://127.0.0.1:9222/json/list",
  ],
  [
    "wss://browser.example:443/devtools/browser/1",
    "https://browser.example/json/list",
  ],
  // Behind a proxy that serves the browser under a path, as Playwright
  // joins it.
  [
    "http://proxy.example/team/chrome",
    "http://proxy.example/team/chrome/json/list",
  ],
  [
    "ws://proxy.example/team/chrome/devtools/browser/5e0c-41",
    "http://proxy.example/team/chrome/json/list",
  ],
  [
    "https://proxy.example/team/chrome/?token=t",
    "https://proxy.example/team/chrome/json/list?token=t",
  ],
])("reads the tab list of the browser at %s from %s", (address, list) => {
  expect(tabListAddress(address)).toBe(list);
});

it("refuses a socket address that tells no tab list", () => {
  expect(() => tabListAddress("ws://127.0.0.1:9222/socket")).toThrow(
    "ws://127.0.0.1:9222/socket is a DevTools socket that tells nothing of where the browser lists its tabs, which ayme reads over HTTP. Join the browser at its HTTP address, such as http://127.0.0.1:9222, or at a socket address that ends in /devtools/browser/<id>."
  );
});

it("keeps the browser's order of its tabs, most recently active first, and leaves out every target that is no tab", () => {
  // As Chromium gives them, with more about each than ayme reads.
  const list = [
    { id: "C", type: "page", url: "http://127.0.0.1:5173/sign-in.html" },
    { id: "W", type: "service_worker", url: "http://127.0.0.1:5173/sw.js" },
    { id: "A", type: "page", url: "http://127.0.0.1:5173/shop.html" },
    { id: "F", type: "iframe", url: "http://127.0.0.1:5174/" },
    { id: "B", type: "page", url: "about:blank" },
  ];

  expect(pageTargets(list)).toEqual(["C", "A", "B"]);
});

describe("the pages of the listed tabs", () => {
  /** Reads that hand over `each` in turn, the last one again and again. */
  const reads = (...each: Record<string, string>[]) => {
    let read = 0;
    return async () =>
      new Map(Object.entries(each[Math.min(read++, each.length - 1)]!));
  };

  it("waits for a listed tab Playwright has not handed over yet, such as a popup that just opened", async () => {
    const pages = await handedOver(
      ["popup", "opener"],
      reads(
        { opener: "opener page" },
        { opener: "opener page", popup: "popup page" }
      ),
      { pause: async () => {}, over: () => false, skipped: new Set() }
    );

    expect(pages).toEqual(["popup page", "opener page"]);
  });

  it("leaves out a tab not handed over when the wait is over, and waits for it no more", async () => {
    const skipped = new Set<string>();
    let pauses = 0;
    const waiting = {
      pause: async () => void pauses++,
      over: () => pauses === 2,
      skipped,
    };
    const read = reads({ opener: "opener page" });

    expect(await handedOver(["other", "opener"], read, waiting)).toEqual([
      "opener page",
    ]);
    expect(pauses).toBe(2);

    expect(await handedOver(["other", "opener"], read, waiting)).toEqual([
      "opener page",
    ]);
    expect(pauses).toBe(2);

    // Once it is no longer listed, it is forgotten.
    await handedOver(["opener"], read, waiting);
    expect(skipped).toEqual(new Set());
  });
});

describe("a read of the tab list", () => {
  /** A server on a free port that answers each request with `answer`, and
   * the address of its tab list. */
  async function serving(
    answer: (request: IncomingMessage, response: ServerResponse) => void
  ) {
    const server = createServer(answer);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    onTestFinished(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        })
    );
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/json/list`;
  }
  const reading = { signal: new AbortController().signal, deadline: 5000 };

  it("gives the ids of the tabs the list answers", async () => {
    const list = await serving((_, response) =>
      response.end(
        JSON.stringify([{ id: "A", type: "page", url: "about:blank" }])
      )
    );

    expect(await readTabOrder(list, reading)).toEqual(["A"]);
  });

  it("refuses an answer with a failing HTTP status", async () => {
    const list = await serving((_, response) => {
      response.statusCode = 502;
      response.end("[]");
    });

    await expect(readTabOrder(list, reading)).rejects.toThrow(
      `${list} answered with HTTP status 502.`
    );
  });

  it.each([
    ["no list", { id: "A", type: "page" }],
    ["an entry that is no target", ["A"]],
    ["a page without an id", [{ type: "page", url: "about:blank" }]],
  ])("refuses an answer that gives %s", async (_, body) => {
    const list = await serving((_, response) =>
      response.end(JSON.stringify(body))
    );

    await expect(readTabOrder(list, reading)).rejects.toThrow(
      `${list} answered something other than the browser's tab list: ${_}.`
    );
  });

  it("refuses to follow a redirect, so the read never leaves the address it was given", async () => {
    let followed = false;
    const elsewhere = await serving((_, response) => {
      followed = true;
      response.end("[]");
    });
    const list = await serving((_, response) => {
      response.writeHead(302, { location: elsewhere });
      response.end();
    });

    await expect(readTabOrder(list, reading)).rejects.toThrow(
      `${list} redirected to ${elsewhere}. ayme reads the tab list only at the address the browser was joined at.`
    );
    expect(followed).toBe(false);
  });

  it("gives up on a list whose body never ends, at its deadline", async () => {
    const list = await serving((_, response) => response.write("[{"));

    await expect(
      readTabOrder(list, { ...reading, deadline: 100 })
    ).rejects.toThrow(`${list} did not answer within 0.1 seconds.`);
  });

  it("stops when the Session ends", async () => {
    const list = await serving((_, response) => response.write("[{"));
    const ending = new AbortController();

    const read = readTabOrder(list, { signal: ending.signal, deadline: 5000 });
    ending.abort();

    await expect(read).rejects.toThrow();
  });
});
