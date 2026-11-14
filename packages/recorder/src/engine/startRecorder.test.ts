import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { toolbarBridge, type WindowServer } from "../server/infrastructure";
import {
  recorderOptionsOf,
  stockOptionsOf,
  toolbarFor,
  type RecorderOptions,
} from "./startRecorder";

// What `startRecorder` asks of the stock adapter and of the recorder, from
// the caller's options: each decided here, apart from launching anything.

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "ayme-recorder-options-"));
});
afterEach(() => rm(folder, { recursive: true }));

describe("the in-page toolbar a caller asks for", () => {
  it("is nothing when none is asked for", async () => {
    expect(await toolbarFor({ projectDir: "/p", browser: attach })).toBe(
      undefined
    );
  });

  it("is the script's text and a bridge to the recorder", async () => {
    const script = join(folder, "toolbar.js");
    await writeFile(script, "console.log('toolbar');\n");

    const kit = await toolbarFor({
      projectDir: "/p",
      browser: attach,
      toolbar: { script },
    });

    expect(kit?.script).toBe("console.log('toolbar');\n");
    expect(kit?.bridge.answer).toBeTypeOf("function");
  });

  it("fails at once when its script is not there, before anything opens", async () => {
    await expect(
      toolbarFor({
        projectDir: "/p",
        browser: attach,
        toolbar: { script: join(folder, "missing.js") },
      })
    ).rejects.toThrow(/ENOENT/);
  });
});

const attach: RecorderOptions["browser"] = {
  attach: { cdpEndpoint: "http://127.0.0.1:9222" },
};

describe("what the stock adapter is asked for", () => {
  const bridge = toolbarBridge();
  const kit = { script: "the script", bridge };
  const shown = { script: "the script", answer: bridge.answer };

  it("attaches to the running browser, with the toolbar when there is one", () => {
    expect(
      stockOptionsOf({ projectDir: "/p", browser: attach }, undefined, kit)
    ).toEqual({
      projectDir: "/p",
      cdpEndpoint: "http://127.0.0.1:9222",
      toolbar: shown,
    });
    expect(
      stockOptionsOf(
        { projectDir: "/p", browser: attach },
        undefined,
        undefined
      )
    ).toEqual({
      projectDir: "/p",
      cdpEndpoint: "http://127.0.0.1:9222",
      toolbar: undefined,
    });
  });

  it("launches a browser on the URL, headed unless told, with the window's address", () => {
    const options: RecorderOptions = {
      projectDir: "/p",
      browser: { launch: { url: "http://shop.test/" } },
    };

    expect(stockOptionsOf(options, "http://127.0.0.1:53124/", kit)).toEqual({
      projectDir: "/p",
      url: "http://shop.test/",
      headless: false,
      debugPort: undefined,
      windowUrl: "http://127.0.0.1:53124/",
      toolbar: shown,
    });
  });

  it("launches without a window, on a debug port, when asked", () => {
    expect(
      stockOptionsOf(
        {
          projectDir: "/p",
          browser: {
            launch: {
              url: "http://shop.test/",
              headless: true,
              debugPort: 9333,
            },
          },
        },
        undefined,
        undefined
      )
    ).toEqual({
      projectDir: "/p",
      url: "http://shop.test/",
      headless: true,
      debugPort: 9333,
      windowUrl: undefined,
      toolbar: undefined,
    });
  });
});

describe("what the recorder is started with", () => {
  it("is the project's folder, the window's server and the toolbar's bridge", () => {
    const window = { url: "http://127.0.0.1:1/" } as WindowServer;
    const bridge = toolbarBridge();

    expect(recorderOptionsOf("/p", window, { script: "s", bridge })).toEqual({
      projectDir: "/p",
      window,
      toolbar: bridge,
    });
    expect(recorderOptionsOf("/p", undefined, undefined)).toEqual({
      projectDir: "/p",
      window: undefined,
      toolbar: undefined,
    });
  });
});
