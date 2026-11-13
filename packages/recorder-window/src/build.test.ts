import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The window's build is what the engine serves: index.html and one script.
// It knows the engine only through the contract, which is types: nothing of
// the engine, and nothing of Node, may be in it.

const window = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "window"
);
const script = readFileSync(join(window, "window.js"), "utf8");

const SPECIFIER =
  /(?:import|export)\s*(?:[^"']*?\sfrom\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

it("loads the window's one script from its page", () => {
  expect(readFileSync(join(window, "index.html"), "utf8")).toContain(
    'src="./window.js"'
  );
  // The check reads the build: the window's own words are in it.
  expect(script).toContain("Recorder controls");
});

it("leaves nothing to resolve where it is served: no Node built-in, no package", () => {
  expect(
    [...script.matchAll(SPECIFIER)].map((match) => match[1] ?? match[2])
  ).toEqual([]);
  expect(/["'`]node:[a-z]/.test(script)).toBe(false);
});

it("carries no engine code", () => {
  // Names only the engine's code holds: its session, its recorded browser,
  // the page's gate and the server's side of the channel.
  for (const engineOnly of [
    "@ayme-dev/recorder/session/RecorderSession",
    "@ayme-dev/recorder/session/RecordedBrowser",
    "__aymeRecorderHeld",
    "getWSConnectionHandler",
  ])
    expect(script, engineOnly).not.toContain(engineOnly);
});

describe("the toolbar's build", () => {
  // One classic script, which the engine runs in every recorded document
  // before the page's own: no module syntax, and nothing to resolve.
  const toolbar = readFileSync(
    join(window, "..", "toolbar", "toolbar.js"),
    "utf8"
  );

  it("is a classic script that leaves nothing to resolve", () => {
    expect(toolbar).toContain("Recorder toolbar");
    expect(
      [...toolbar.matchAll(SPECIFIER)].map((match) => match[1] ?? match[2])
    ).toEqual([]);
    expect(/["'`]node:[a-z]/.test(toolbar)).toBe(false);
  });

  it("carries no engine code and opens no socket", () => {
    for (const engineOnly of [
      "@ayme-dev/recorder/session/RecorderSession",
      "__aymeRecorderHeld",
      "getWSConnectionHandler",
      "WebSocket",
    ])
      expect(toolbar, engineOnly).not.toContain(engineOnly);
  });
});
