import { fileURLToPath } from "node:url";

import { build, createLogger, createServer } from "vite";
import { expect, it, vi } from "vitest";

import { ayme } from "./vite";

// Integration: every Vite build, and a dev server at start, prints one line
// through Vite's logger saying whether Ayme is in it.

const entry = fileURLToPath(
  new URL("./fixtures/twoPagesPom.ts", import.meta.url)
);

const cases: [string, { include?: boolean }, string][] = [
  [
    "include unset",
    {},
    "[ayme] Ayme is not in this build: include is not set.",
  ],
  [
    "include false",
    { include: false },
    "[ayme] Ayme is not in this build: include is false.",
  ],
  [
    "include true",
    { include: true },
    "[ayme] Ayme is in this build: include is true.",
  ],
];

function spiedLogger() {
  const logger = createLogger("info");
  const info = vi.spyOn(logger, "info").mockImplementation(() => {});
  const aymeLines = () =>
    info.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.startsWith("[ayme] Ayme"));
  return { logger, aymeLines };
}

it.each(cases)(
  "a build prints the line once with %s",
  async (_, options, line) => {
    const { logger, aymeLines } = spiedLogger();
    await build({
      configFile: false,
      customLogger: logger,
      plugins: [ayme({ ...options, report: "none" })],
      build: {
        write: false,
        rolldownOptions: {
          input: entry,
          external: [/^@ayme-dev\//, /^@playwright\//],
        },
      },
    });
    expect(aymeLines()).toEqual([line]);
  },
  30_000
);

it("a server build prints no line: a client build already did", async () => {
  const { logger, aymeLines } = spiedLogger();
  await build({
    configFile: false,
    customLogger: logger,
    plugins: [ayme({ report: "none" })],
    build: {
      write: false,
      ssr: entry,
      rolldownOptions: { external: [/^@ayme-dev\//, /^@playwright\//] },
    },
  });
  expect(aymeLines()).toEqual([]);
}, 30_000);

it("a dev server prints the line once at start, not per module", async () => {
  const { logger, aymeLines } = spiedLogger();
  const server = await createServer({
    configFile: false,
    customLogger: logger,
    plugins: [ayme({ report: "none" })],
    server: { middlewareMode: true, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    expect(aymeLines()).toEqual([
      "[ayme] Ayme is not in this build: include is not set.",
    ]);
    await server.environments.client.transformRequest(`/@fs${entry}`);
    expect(aymeLines()).toHaveLength(1);
  } finally {
    await server.close();
  }
}, 30_000);
