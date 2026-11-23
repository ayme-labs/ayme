import { describe, expect, it } from "vitest";

import { readCommand, USAGE } from "./readCommand";

describe("readCommand", () => {
  it("reads --version as a request for the installed version", () => {
    expect(readCommand(["--version"])).toEqual({ kind: "version" });
  });

  it.each([
    [["codgen", "--version"]],
    [["codegen", "http://localhost", "--version"]],
    [["--version", "codegen", "http://localhost"]],
  ])("reads --version only by itself, not beside a command: `%s`", (args) => {
    expect(readCommand(args).kind).toBe("error");
  });

  it("lists --version in its usage text", () => {
    expect(USAGE).toContain("--version");
  });

  it.each([["-v"], ["version"]])(
    "has no short form or command for the version: `%s`",
    (word) => {
      expect(readCommand([word]).kind).toBe("error");
    }
  );

  it("lists the trace command in its usage text", () => {
    expect(USAGE).toContain("trace");
  });

  it("records the page at the URL for `codegen <url>`", () => {
    expect(readCommand(["codegen", "http://localhost:5173/cart"])).toEqual({
      kind: "codegen",
      url: "http://localhost:5173/cart",
    });
  });

  it("records a running browser for `codegen --cdp-endpoint <address>`, with no URL", () => {
    expect(
      readCommand(["codegen", "--cdp-endpoint", "http://127.0.0.1:9222"])
    ).toEqual({ kind: "attach", cdpEndpoint: "http://127.0.0.1:9222" });
  });

  it("fails with the usage text when it is given both a URL and a running browser", () => {
    expect(
      readCommand([
        "codegen",
        "http://localhost",
        "--cdp-endpoint",
        "http://127.0.0.1:9222",
      ])
    ).toEqual({
      kind: "error",
      text: `Give either a URL or --cdp-endpoint, not both: attaching never navigates the page.\n\n${USAGE}`,
    });
  });

  it.each([
    { args: ["latest"] },
    { args: ["rec_20261112T145047604Z"] },
    { args: ["open", "latest"] },
    // The stock tool's own words and flags are left as they are.
    { args: ["snapshot", "4", "--phase", "after", "eval", "document.title"] },
    { args: ["--help"] },
    { args: [] },
  ])("hands `trace $args` on to the stock trace tool as it is", ({ args }) => {
    expect(readCommand(["trace", ...args])).toEqual({ kind: "trace", args });
  });

  it.each([
    { args: ["chromium"], passed: ["chromium"] },
    { args: ["firefox"], passed: ["firefox"] },
    // The stock tool's own flags are left as they are.
    { args: ["--with-deps", "chromium"], passed: ["--with-deps", "chromium"] },
    // The recorder records in Chromium: that is what `install` gets by default.
    { args: [], passed: ["chromium"] },
  ])(
    "hands `install $args` on to the project's own Playwright",
    ({ args, passed }) => {
      expect(readCommand(["install", ...args])).toEqual({
        kind: "install",
        args: passed,
      });
    }
  );

  it("lists the install command in its usage text", () => {
    expect(USAGE).toContain("install");
  });

  it("records without a window for `codegen <url> --headless`", () => {
    expect(readCommand(["codegen", "http://localhost", "--headless"])).toEqual({
      kind: "codegen",
      url: "http://localhost",
      headless: true,
    });
  });

  it("refuses --headed as any unknown option, and no longer lists it", () => {
    const command = readCommand(["codegen", "http://localhost", "--headed"]);

    expect(command.kind).toBe("error");
    expect(command).toHaveProperty(
      "text",
      expect.stringMatching(/^Unknown option '--headed'/)
    );
    expect(command).toHaveProperty("text", expect.stringContaining(USAGE));
    expect(USAGE).not.toContain("--headed");
  });

  it.each([
    { flags: ["--start-recording"], expected: {} },
    {
      flags: ["--headless", "--start-recording"],
      expected: { headless: true },
    },
  ])(
    "opens the recorder already recording for `codegen <url> $flags`",
    ({ flags, expected }) => {
      expect(readCommand(["codegen", "http://localhost", ...flags])).toEqual({
        kind: "codegen",
        url: "http://localhost",
        ...expected,
        startRecording: true,
      });
    }
  );

  it("lists --start-recording in its usage text", () => {
    expect(USAGE).toContain("--start-recording");
  });

  it.each([["--headless"], ["--start-recording"]])(
    "fails when a running browser is given %s: it applies only to a browser launched here",
    (flag) => {
      expect(
        readCommand([
          "codegen",
          "--cdp-endpoint",
          "http://127.0.0.1:9222",
          flag,
        ])
      ).toEqual({
        kind: "error",
        text: `--headless and --start-recording apply when the recorder opens the browser, not with --cdp-endpoint.\n\n${USAGE}`,
      });
    }
  );

  it("lists --load-storage and --save-storage in its usage text", () => {
    expect(USAGE).toContain("--load-storage <file>");
    expect(USAGE).toContain("--save-storage <file>");
  });

  it("records with the storage state files it is given, as Playwright's codegen takes them", () => {
    expect(
      readCommand([
        "codegen",
        "http://localhost",
        "--load-storage",
        "auth.json",
        "--save-storage",
        "saved.json",
      ])
    ).toEqual({
      kind: "codegen",
      url: "http://localhost",
      loadStorage: "auth.json",
      saveStorage: "saved.json",
    });
  });

  it.each([["--load-storage"], ["--save-storage"]])(
    "fails when a running browser is given %s: its storage is the browser's own",
    (flag) => {
      expect(
        readCommand([
          "codegen",
          "--cdp-endpoint",
          "http://127.0.0.1:9222",
          flag,
          "auth.json",
        ])
      ).toEqual({
        kind: "error",
        text: `--load-storage and --save-storage apply when the recorder opens the browser, not with --cdp-endpoint: the running browser's storage is its own, and saving it would open a page in it.\n\n${USAGE}`,
      });
    }
  );

  it.each([["--help"], ["-h"], ["codegen", "--help"]])(
    "prints the usage text for %j",
    (...args) => {
      expect(readCommand(args)).toEqual({ kind: "help", text: USAGE });
    }
  );

  it.each([
    { name: "no command", args: [] },
    { name: "an unknown command", args: ["record", "http://localhost"] },
    { name: "codegen without a URL", args: ["codegen"] },
    { name: "codegen with two URLs", args: ["codegen", "a", "b"] },
    {
      name: "a running browser's address with no command",
      args: ["--cdp-endpoint", "http://127.0.0.1:9222"],
    },
    {
      name: "a running browser's address and another command",
      args: ["record", "--cdp-endpoint", "http://127.0.0.1:9222"],
    },
    {
      name: "a running browser's address and two URLs",
      args: ["codegen", "a", "b", "--cdp-endpoint", "http://127.0.0.1:9222"],
    },
  ])("fails with the usage text for $name", ({ args }) => {
    expect(readCommand(args)).toEqual({ kind: "error", text: USAGE });
  });

  it("fails with the message and the usage text for an unknown option", () => {
    const command = readCommand(["codegen", "http://localhost", "--nope"]);

    expect(command.kind).toBe("error");
    expect(command).toHaveProperty(
      "text",
      expect.stringMatching(/^Unknown option '--nope'/)
    );
    expect(command).toHaveProperty("text", expect.stringContaining(USAGE));
  });
});
