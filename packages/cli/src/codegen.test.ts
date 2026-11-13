import { describe, expect, it } from "vitest";

import {
  exitCode,
  launchOptions,
  outcomeLine,
  startLine,
  warningPrinter,
  windowFolder,
  windowLine,
} from "./codegen";

describe("how codegen launches the browser", () => {
  it("opens the URL in a browser with a window", () => {
    expect(launchOptions("http://localhost:5173/cart", {})).toEqual({
      url: "http://localhost:5173/cart",
      headless: false,
    });
  });

  it("launches without a window when the tests ask for it", () => {
    expect(
      launchOptions("http://localhost", { AYME_RECORDER_HEADLESS: "1" })
    ).toEqual({ url: "http://localhost", headless: true });
  });

  it("follows the command line over the tests' setting for the window", () => {
    const env = { AYME_RECORDER_HEADLESS: "1" };

    expect(launchOptions("http://localhost", env, false)).toEqual({
      url: "http://localhost",
      headless: false,
    });
    expect(launchOptions("http://localhost", {}, true)).toEqual({
      url: "http://localhost",
      headless: true,
    });
  });

  it("opens the debug port the tests name", () => {
    expect(
      launchOptions("http://localhost", { AYME_RECORDER_DEBUG_PORT: "9333" })
    ).toEqual({ url: "http://localhost", headless: false, debugPort: 9333 });
  });
});

describe("where the recorder window's files are", () => {
  it("is the window folder beside the command's own file, which the build fills", () => {
    expect(windowFolder("file:///usr/lib/node_modules/cli/dist/cli.mjs")).toBe(
      "/usr/lib/node_modules/cli/dist/window"
    );
  });
});

describe("what the terminal is told at the start", () => {
  it("says which page it opened", () => {
    expect(startLine({ launch: { url: "http://localhost:5173/cart" } })).toBe(
      "Opened http://localhost:5173/cart. Close the browser, or press Ctrl+C here, to end.\n"
    );
  });

  it("says which browser it attached to, and that the browser stays open", () => {
    expect(
      startLine({ attach: { cdpEndpoint: "http://127.0.0.1:9222" } })
    ).toBe(
      "Attached to the browser at http://127.0.0.1:9222. Close its page, or press Ctrl+C here, to end: the browser stays open.\n"
    );
  });
});

describe("what the terminal is told at the end", () => {
  it("says why the recorder failed", () => {
    expect(
      outcomeLine({ kind: "failed", reason: "ENOSPC: no space left on device" })
    ).toBe("The recorder failed: ENOSPC: no space left on device\n");
  });

  it("exits with an error only when the recorder failed", () => {
    expect(exitCode({ kind: "failed", reason: "ENOSPC" })).toBe(1);
    expect(exitCode({ kind: "empty" })).toBe(0);
    expect(exitCode({ kind: "saved", folder: "/project/rec" })).toBe(0);
  });

  it("says that nothing was recorded", () => {
    expect(outcomeLine({ kind: "empty" })).toBe("Nothing was recorded.\n");
  });

  it("names the saved package's file, as the released recorder does", () => {
    expect(
      outcomeLine({
        kind: "saved",
        folder: "/project/.ayme/recordings/rec_20261112T145047604Z",
      })
    ).toBe(
      "Recording package: /project/.ayme/recordings/rec_20261112T145047604Z/package.yaml\n"
    );
  });
});

describe("what the terminal is told of warnings", () => {
  it("prints each new warning once, as it comes", () => {
    const printed: string[] = [];
    const print = warningPrinter((text) => printed.push(text));
    const shape = { kind: "reportShape", message: "One." } as const;
    const trace = { kind: "traceWithoutPositions", message: "Two." } as const;

    print([]);
    print([shape]);
    print([shape]);
    print([shape, trace]);

    expect(printed).toEqual(["Warning: One.\n", "Warning: Two.\n"]);
  });
});

describe("what the terminal is told of the window", () => {
  it("gives the recorder window's address, to open it in any browser", () => {
    expect(windowLine("http://127.0.0.1:53124/")).toBe(
      "Recorder window: http://127.0.0.1:53124/\n"
    );
  });
});
