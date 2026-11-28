import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inspectorScript, session } from "./session";

// Unit tests: what a command that reaches a Session prints and exits with,
// in a project folder where no Session is open. The command file a Session's
// background process runs is a stub that prints what it was started with
// and exits, so no Session starts: the end-to-end tests in
// `apps/mcp-fixture` start real ones.

let folder: string;
let printed: { stdout: string; stderr: string };
const commandFile = process.argv[1];

beforeEach(() => {
  folder = realpathSync(mkdtempSync(join(tmpdir(), "ayme-cli-session-")));
  vi.spyOn(process, "cwd").mockReturnValue(folder);
  vi.stubEnv("AYME_CACHE_DIR", join(folder, "cache"));
  const stub = join(folder, "command.mjs");
  writeFileSync(
    stub,
    "console.log(JSON.stringify(process.argv.slice(2))); process.exit(1);\n"
  );
  process.argv[1] = stub;
  printed = { stdout: "", stderr: "" };
  for (const stream of ["stdout", "stderr"] as const)
    vi.spyOn(process[stream], "write").mockImplementation((text) => {
      printed[stream] += String(text);
      return true;
    });
});
afterEach(() => {
  process.argv[1] = commandFile;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(folder, { recursive: true, force: true });
});

/** What the stub command printed it was started with: the Session's
 * process word and its options. */
const startedWith = (): { word: string; options: Record<string, unknown> } => {
  const [word, options] = JSON.parse(printed.stderr) as [string, string];
  return { word, options: JSON.parse(options) };
};

describe("a command that reaches a Session", () => {
  it("lists the folder's Sessions on stdout, and exits with 0", async () => {
    expect(await session({ kind: "list", json: false })).toBe(0);
    expect(printed).toEqual({
      stdout: `No Session is open in ${folder}.\n`,
      stderr: "",
    });
  });

  it("prints the answer as JSON for --json", async () => {
    await session({ kind: "list", json: true });
    expect(JSON.parse(printed.stdout)).toEqual({
      ok: true,
      text: `No Session is open in ${folder}.`,
      data: { sessions: [] },
    });
  });

  it("asks the Session -s names, and says on stderr, exiting with 1, that none is open", async () => {
    expect(
      await session({
        kind: "ask",
        request: { stop: {} },
        json: false,
        session: "shop",
      })
    ).toBe(1);
    expect(printed.stdout).toBe("");
    expect(printed.stderr).toMatch(
      new RegExp(`^No Session named shop is open in ${folder}\\.`)
    );
  });

  it("starts a Run with the --params given, which the Session's call reads", async () => {
    expect(
      await session({
        kind: "call",
        tool: "Basket.add",
        params: "{",
        json: false,
      })
    ).toBe(1);
    expect(printed.stderr).toMatch(/^--params is not JSON: /);

    printed.stderr = "";
    await session({ kind: "call", tool: "Basket.add", json: false });
    expect(printed.stderr).toMatch(
      new RegExp(`^No Session is open in ${folder}\\.`)
    );
  });

  it("starts a Session for `open` by running this same command as its background process, with the open request", async () => {
    expect(
      await session({
        kind: "open",
        open: { url: "http://localhost:5173/", headed: true },
        json: false,
        session: "shop",
      })
    ).toBe(1);
    expect(startedWith()).toEqual({
      word: "__session",
      options: expect.objectContaining({
        projectDir: folder,
        name: "shop",
        request: { open: { url: "http://localhost:5173/", headed: true } },
      }),
    });
  });

  it("starts a Session for `attach` that joins the browser at the address", async () => {
    await session({
      kind: "attach",
      cdp: "http://127.0.0.1:9222",
      json: false,
    });
    expect(startedWith()).toEqual({
      word: "__session",
      options: expect.objectContaining({
        projectDir: folder,
        request: { join: { cdp: "http://127.0.0.1:9222" } },
      }),
    });
  });
});

describe("where the Inspector's external build is", () => {
  it("is inspector/external.mjs beside the command's own file, which the build fills", () => {
    expect(
      inspectorScript(pathToFileURL("/app/node_modules/ayme/dist/cli.mjs").href)
    ).toBe("/app/node_modules/ayme/dist/inspector/external.mjs");
  });
});
