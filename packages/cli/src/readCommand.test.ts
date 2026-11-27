import { describe, expect, it } from "vitest";

import { readCommand, USAGE } from "./readCommand";

describe("readCommand", () => {
  it("reads --version as a request for the installed version", () => {
    expect(readCommand(["--version"])).toEqual({ kind: "version" });
  });

  it.each([
    [["captur", "--version"]],
    [["capture", "http://localhost", "--version"]],
    [["--version", "capture", "http://localhost"]],
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

  it("names the command ayme in its usage text, and ayme capture as the way to record", () => {
    expect(USAGE).toMatch(/^Usage: ayme capture <url>/);
    expect(USAGE).not.toContain("ayme-recorder");
    expect(USAGE).not.toMatch(/^ {2}codegen\b/m);
  });

  it("records the page at the URL for `capture <url>`", () => {
    expect(readCommand(["capture", "http://localhost:5173/cart"])).toEqual({
      kind: "capture",
      target: { url: "http://localhost:5173/cart" },
    });
  });

  it.each([
    [["capture", "--cdp=http://127.0.0.1:9222"]],
    [["capture", "--cdp", "http://127.0.0.1:9222"]],
  ])("records a running browser for `%s`, with no URL", (args) => {
    expect(readCommand(args)).toEqual({
      kind: "capture",
      target: { cdp: "http://127.0.0.1:9222" },
    });
  });

  it("lists --cdp=<url> in its usage text, and not the flag it replaced", () => {
    expect(USAGE).toContain("--cdp=<url>");
    expect(USAGE).not.toContain("--cdp-endpoint");
  });

  it("refuses --cdp-endpoint as any unknown option", () => {
    const command = readCommand([
      "capture",
      "--cdp-endpoint",
      "http://127.0.0.1:9222",
    ]);

    expect(command).toHaveProperty(
      "text",
      expect.stringMatching(/^Unknown option '--cdp-endpoint'/)
    );
  });

  it("fails with the usage text when it is given both a URL and a running browser", () => {
    expect(
      readCommand([
        "capture",
        "http://localhost",
        "--cdp=http://127.0.0.1:9222",
      ])
    ).toEqual({
      kind: "error",
      text: `Give either a URL or --cdp, not both: attaching never navigates the page.\n\n${USAGE}`,
    });
  });

  it.each([
    { name: "trace", args: ["trace", "latest"] },
    { name: "install", args: ["install", "chromium"] },
    { name: "codegen", args: ["codegen", "http://localhost"] },
  ])("has no $name command: Playwright's own commands do that", ({ args }) => {
    expect(readCommand(args)).toEqual({ kind: "error", text: USAGE });
  });

  it("lists neither trace nor install in its usage text", () => {
    expect(USAGE).not.toMatch(/ayme (?:trace|install)\b/);
    expect(USAGE).not.toMatch(/^ {2}(?:trace|install)\b/m);
  });

  it("records without a window for `capture <url> --headless`", () => {
    expect(readCommand(["capture", "http://localhost", "--headless"])).toEqual({
      kind: "capture",
      target: { url: "http://localhost", headless: true },
    });
  });

  it("refuses --headed for capture as any unknown option, and no longer lists it there", () => {
    const command = readCommand(["capture", "http://localhost", "--headed"]);

    expect(command.kind).toBe("error");
    expect(command).toHaveProperty(
      "text",
      expect.stringMatching(/^Unknown option '--headed'/)
    );
    expect(command).toHaveProperty("text", expect.stringContaining(USAGE));
    // `ayme open` takes --headed: it opens Chromium headless by default.
    expect(
      USAGE.split("\n").filter((line) => line.includes("ayme capture"))
    ).not.toContainEqual(expect.stringContaining("--headed"));
  });

  it.each([
    { flags: ["--start-recording"], expected: {} },
    {
      flags: ["--headless", "--start-recording"],
      expected: { headless: true },
    },
  ])(
    "opens the recorder already recording for `capture <url> $flags`",
    ({ flags, expected }) => {
      expect(readCommand(["capture", "http://localhost", ...flags])).toEqual({
        kind: "capture",
        target: { url: "http://localhost", ...expected, startRecording: true },
      });
    }
  );

  it("lists --start-recording in its usage text", () => {
    expect(USAGE).toContain("--start-recording");
  });

  it.each([["--headless"], ["--start-recording"]])(
    "fails when a running browser is given %s: it applies only to a browser opened here",
    (flag) => {
      expect(
        readCommand(["capture", "--cdp=http://127.0.0.1:9222", flag])
      ).toEqual({
        kind: "error",
        text: `--headless and --start-recording apply when the recorder opens the browser, not with --cdp.\n\n${USAGE}`,
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
        "capture",
        "http://localhost",
        "--load-storage",
        "auth.json",
        "--save-storage",
        "saved.json",
      ])
    ).toEqual({
      kind: "capture",
      target: {
        url: "http://localhost",
        loadStorage: "auth.json",
        saveStorage: "saved.json",
      },
    });
  });

  it.each([["--load-storage="], ["--save-storage="]])(
    "fails when %s is given no file name",
    (flag) => {
      expect(readCommand(["capture", "http://localhost", flag])).toEqual({
        kind: "error",
        text: `Give --load-storage and --save-storage the name of a file.\n\n${USAGE}`,
      });
    }
  );

  it.each([["--load-storage"], ["--save-storage"]])(
    "fails when a running browser is given %s: its storage is the browser's own",
    (flag) => {
      expect(
        readCommand([
          "capture",
          "--cdp=http://127.0.0.1:9222",
          flag,
          "auth.json",
        ])
      ).toEqual({
        kind: "error",
        text: `--load-storage and --save-storage apply when the recorder opens the browser, not with --cdp: the running browser's storage is its own, and saving it would open a page in it.\n\n${USAGE}`,
      });
    }
  );

  it.each([["--help"], ["-h"], ["capture", "--help"]])(
    "prints the usage text for %j",
    (...args) => {
      expect(readCommand(args)).toEqual({ kind: "help", text: USAGE });
    }
  );

  it.each([
    { name: "no command", args: [] },
    { name: "an unknown command", args: ["record", "http://localhost"] },
    { name: "capture without a URL", args: ["capture"] },
    { name: "capture with two URLs", args: ["capture", "a", "b"] },
    {
      name: "a running browser's address with no command",
      args: ["--cdp=http://127.0.0.1:9222"],
    },
    {
      name: "a running browser's address and another command",
      args: ["record", "--cdp=http://127.0.0.1:9222"],
    },
    {
      name: "a running browser's address and two URLs",
      args: ["capture", "a", "b", "--cdp=http://127.0.0.1:9222"],
    },
  ])("fails with the usage text for $name", ({ args }) => {
    expect(readCommand(args)).toEqual({ kind: "error", text: USAGE });
  });

  it("fails with the message and the usage text for an unknown option", () => {
    const command = readCommand(["capture", "http://localhost", "--nope"]);

    expect(command.kind).toBe("error");
    expect(command).toHaveProperty(
      "text",
      expect.stringMatching(/^Unknown option '--nope'/)
    );
    expect(command).toHaveProperty("text", expect.stringContaining(USAGE));
  });
});

describe("readCommand for a Session", () => {
  it("starts a Session for `open`, headless by default", () => {
    expect(readCommand(["open"])).toEqual({
      kind: "open",
      open: { headed: false },
      json: false,
    });
  });

  it("starts a Session at the URL, with a window for --headed, for `open <url> --headed`", () => {
    expect(readCommand(["open", "http://localhost:5173/", "--headed"])).toEqual(
      {
        kind: "open",
        open: { url: "http://localhost:5173/", headed: true },
        json: false,
      }
    );
  });

  it("stops the Session for `close`", () => {
    expect(readCommand(["close"])).toEqual({
      kind: "ask",
      request: { stop: {} },
      json: false,
    });
  });

  it.each([
    ["page-objects", { pageObjects: {} }],
    ["tools", { tools: {} }],
  ])("asks the Session for its listing for `%s`", (word, request) => {
    expect(readCommand([word])).toEqual({ kind: "ask", request, json: false });
    expect(readCommand([word, "--json"])).toMatchObject({ json: true });
  });

  it.each([[["--json", "close"]], [["close", "--json"]]])(
    "asks for the answer as JSON with the global --json: `%s`",
    (args) => {
      expect(readCommand(args)).toMatchObject({ json: true });
    }
  );

  it.each([
    [["open", "http://a", "http://b"]],
    [["close", "now"]],
    [["close", "--headed"]],
    [["page-objects", "now"]],
    [["tools", "--headed"]],
  ])("refuses what the command does not take: `%s`", (args) => {
    expect(readCommand(args).kind).toBe("error");
  });

  it("lists open, close, page-objects, tools and --json in its usage text", () => {
    expect(USAGE).toContain("ayme open [url] [--headed]");
    expect(USAGE).toContain("ayme close");
    expect(USAGE).toContain("ayme page-objects");
    expect(USAGE).toContain("ayme tools");
    expect(USAGE).toContain("--json");
  });

  it("joins the browser at the address for `attach --cdp=<url>`", () => {
    expect(readCommand(["attach", "--cdp=http://127.0.0.1:9222"])).toEqual({
      kind: "attach",
      cdp: "http://127.0.0.1:9222",
      json: false,
    });
    expect(
      readCommand(["attach", "--cdp", "http://127.0.0.1:9222", "--json"])
    ).toMatchObject({ kind: "attach", json: true });
  });

  it("asks for the address when attach has none", () => {
    expect(readCommand(["attach"])).toEqual({
      kind: "error",
      text: expect.stringMatching(
        /^Give ayme attach the address of the browser's DevTools protocol, such as --cdp=http:\/\/127\.0\.0\.1:9222\.\n/
      ),
    });
  });

  it.each([
    [["attach", "--cdp=http://a", "http://b"]],
    [["attach", "--cdp=http://a", "--headed"]],
    [["open", "--cdp=http://a"]],
    [["close", "--cdp=http://a"]],
  ])(
    "refuses --cdp where it does not belong, and what attach does not take: `%s`",
    (args) => {
      expect(readCommand(args).kind).toBe("error");
    }
  );

  it("ends a Session on a joined browser for `detach`", () => {
    expect(readCommand(["detach"])).toEqual({
      kind: "ask",
      request: { detach: {} },
      json: false,
    });
  });

  it("lists the folder's Sessions for `list`", () => {
    expect(readCommand(["list"])).toEqual({ kind: "list", json: false });
    expect(readCommand(["list", "--json"])).toEqual({
      kind: "list",
      json: true,
    });
  });

  it.each([
    [["-s=review", "close"]],
    [["-s", "review", "close"]],
    [["close", "-s=review"]],
    [["--session=review", "close"]],
  ])("names the Session with -s: `%s`", (args) => {
    expect(readCommand(args)).toEqual({
      kind: "ask",
      request: { stop: {} },
      json: false,
      session: "review",
    });
  });

  it("names the Session with AYME_SESSION, unless -s names another", () => {
    const env = { AYME_SESSION: "review" };
    expect(readCommand(["open"], env)).toMatchObject({ session: "review" });
    expect(readCommand(["attach", "--cdp=http://a"], env)).toMatchObject({
      session: "review",
    });
    expect(readCommand(["-s=other", "tools"], env)).toMatchObject({
      session: "other",
    });
    expect(readCommand(["open"], { AYME_SESSION: "" })).not.toHaveProperty(
      "session"
    );
  });

  it("refuses an empty -s", () => {
    expect(readCommand(["-s=", "close"]).kind).toBe("error");
  });

  it("lists attach, detach, list and -s in its usage text", () => {
    expect(USAGE).toContain("ayme attach --cdp=<url>");
    expect(USAGE).toContain("ayme detach");
    expect(USAGE).toContain("ayme list");
    expect(USAGE).toContain("-s=<name>");
    expect(USAGE).toContain("AYME_SESSION");
  });

  it.each([
    [["call", "Basket.add", "--params", '{"id":"po1","args":{"item":"Milk"}}']],
    [["call", "Basket.add", '--params={"id":"po1","args":{"item":"Milk"}}']],
  ])("starts a Run of the tool with the parameters given: `%s`", (args) => {
    expect(readCommand(args)).toEqual({
      kind: "call",
      tool: "Basket.add",
      params: '{"id":"po1","args":{"item":"Milk"}}',
      json: false,
    });
  });

  it("starts a Run with the parameters of a file for `--params @<file>`, and of none without --params", () => {
    expect(
      readCommand(["call", "Basket.add", "--params", "@add.json", "--json"])
    ).toEqual({
      kind: "call",
      tool: "Basket.add",
      params: "@add.json",
      json: true,
    });
    expect(readCommand(["call", "ShopPage.readHeading"])).toEqual({
      kind: "call",
      tool: "ShopPage.readHeading",
      json: false,
    });
  });

  it("starts a Run on the Session -s names", () => {
    expect(readCommand(["-s=review", "call", "Basket.add"])).toEqual({
      kind: "call",
      tool: "Basket.add",
      json: false,
      session: "review",
    });
  });

  it.each([
    [["call"]],
    [["call", "Basket.add", "po1"]],
    [["call", "Basket.add", "--id", "po1"]],
    [["call", "Basket.add", "--headed"]],
    [["call", "Basket.add", "--cdp=http://a"]],
    [["tools", "--params", "{}"]],
    [["attach", "--cdp=http://127.0.0.1:9222", "--params", "{}"]],
    [["open", "--params", "{}"]],
    [["close", "--params", "{}"]],
  ])(
    "refuses a call it cannot read, and --params beside another command: `%s`",
    (args) => {
      expect(readCommand(args).kind).toBe("error");
    }
  );

  it.each([
    [["page-objects", "--tab=http://localhost:5173/basket"]],
    [["page-objects", "--tab", "http://localhost:5173/basket"]],
  ])("asks for the listing of the Tab --tab names by its URL: `%s`", (args) => {
    expect(readCommand(args)).toEqual({
      kind: "ask",
      request: { pageObjects: { tab: "http://localhost:5173/basket" } },
      json: false,
    });
  });

  it("names the Tab for ayme tools and ayme call with --tab", () => {
    expect(readCommand(["tools", "--tab=about:blank"])).toMatchObject({
      request: { tools: { tab: "about:blank" } },
    });
    expect(
      readCommand(["call", "ShopPage.readHeading", "--tab=about:blank"])
    ).toEqual({
      kind: "call",
      tool: "ShopPage.readHeading",
      tab: "about:blank",
      json: false,
    });
  });

  it.each([
    [["close", "--tab=about:blank"]],
    [["open", "--tab=about:blank"]],
    [["attach", "--cdp=http://a", "--tab=about:blank"]],
    [["tools", "--tab="]],
  ])(
    "refuses --tab beside a command that works on no Tab, and an empty one: `%s`",
    (args) => {
      expect(readCommand(args).kind).toBe("error");
    }
  );

  it("lists --tab in its usage text", () => {
    expect(USAGE).toContain("ayme page-objects [--tab=<url>]");
    expect(USAGE).toContain("ayme tools [--tab=<url>]");
    expect(USAGE).toContain("--tab=<url>");
  });

  it("lists call with its --params in its usage text", () => {
    expect(USAGE).toContain(
      "ayme call <tool> [--params <json> | --params @<file>]"
    );
  });

  it("runs the Session's background process for its own word, which the usage text does not name", () => {
    expect(readCommand(["__session", '{"projectDir":"/app"}'])).toEqual({
      kind: "session process",
      options: '{"projectDir":"/app"}',
    });
    expect(USAGE).not.toContain("__session");
  });
});
