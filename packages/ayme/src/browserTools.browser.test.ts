import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPage } from "./browserPage";
import { runPublished } from "./agentCalls.testSupport";
import {
  isCheckableElement,
  isClickableElement,
  isFillableElement,
  isSelectElement,
  isUncheckableElement,
} from "./browserTools";
import { buildToolOptions } from "./goalLoopQuestions";
import {
  FILL_SCHEMA,
  PLAYWRIGHT_MCP_COUNTERPARTS,
  PLAYWRIGHT_MCP_SCHEMAS,
  shapeOf,
  withoutElement,
} from "./playwrightMcp.testSupport";
import { listElementToolTargets } from "./publishedTools";
import { createAyme } from "./runtime";
import { synchronizeWebMcpTools } from "./webMcp";

type PublishedTool = {
  name: string;
  inputSchema: unknown;
  execute(input: unknown): Promise<unknown>;
};

const BROWSER_TOOLS = [
  "click",
  "hover",
  "type",
  "fill",
  "fill_form",
  "check",
  "uncheck",
  "select_option",
  "press_key",
  "generate_locator",
  "navigate",
  "navigate_back",
  "navigate_forward",
  "reload",
];

const FIXTURE = `
  <form id="form" aria-label="Profile">
    <input id="name" aria-label="Name" value="Old">
    <input id="email" aria-label="Email">
    <input id="agree" type="checkbox" aria-label="Agree">
    <select id="size" aria-label="Size">
      <option value="s">Small</option>
      <option value="m">Medium</option>
    </select>
    <button id="save" type="button">Save</button>
  </form>
  <p id="log"></p>
  <button class="twin" type="button">Twin</button>
  <button class="twin" type="button">Twin</button>
`;

describe("Browser Tools in Chromium", () => {
  let tools: Map<string, PublishedTool>;
  let stop: () => void;
  let dispose: () => void;
  let listening: AbortController;
  const log: string[] = [];

  beforeEach(async () => {
    document.body.innerHTML = FIXTURE;
    log.length = 0;
    listening = new AbortController();
    const record = (event: Event) =>
      log.push(`${event.type} ${(event.target as Element).id}`);
    for (const type of ["click", "dblclick", "mouseover", "submit", "keydown"])
      document.addEventListener(type, record, {
        capture: true,
        signal: listening.signal,
      });
    document.querySelector("#form")!.addEventListener("submit", (event) => {
      event.preventDefault();
    });
    const session = createAyme({
      pageFactory: () => createPage({ actionTimeout: 500 }),
    });
    stop = session.start();
    tools = new Map();
    const publication = await synchronizeWebMcpTools(
      {
        async registerTool(tool: PublishedTool) {
          tools.set(tool.name, tool);
        },
      } as never,
      { run: runPublished }
    );
    dispose = publication.dispose;
  });

  afterEach(() => {
    listening.abort();
    dispose();
    stop();
    document.body.innerHTML = "";
  });

  const call = (name: string, input: unknown) =>
    tools.get(name)!.execute(input);

  async function refOf(label: string) {
    const { structure } = (await call("snapshot", {})) as {
      structure: string;
    };
    const ref = structure.match(new RegExp(`(e\\d+) \\w+ "${label}"`))?.[1];
    if (!ref) throw new Error(`Expected a Structural Ref for ${label}.`);
    return ref;
  }

  const value = (selector: string) =>
    document.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!
      .value;
  const checked = () =>
    document.querySelector<HTMLInputElement>("#agree")!.checked;

  it("publishes the Browser Tools with Playwright MCP's input fields, without element", () => {
    for (const name of BROWSER_TOOLS) expect(tools.has(name), name).toBe(true);
    for (const [name, counterpart] of Object.entries(
      PLAYWRIGHT_MCP_COUNTERPARTS
    ))
      expect(shapeOf(tools.get(name)!.inputSchema), name).toEqual(
        withoutElement(PLAYWRIGHT_MCP_SCHEMAS[counterpart])
      );
    expect(shapeOf(tools.get("fill")!.inputSchema)).toEqual(FILL_SCHEMA);
  });

  describe.each([
    ["a Structural Ref", (label: string) => refOf(label)],
    ["a selector", async (_label: string, selector: string) => selector],
  ])("addressed by %s", (_kind, target) => {
    it("clicks, double-clicks and hovers", async () => {
      await call("click", { target: await target("Save", "#save") });
      await call("click", {
        target: await target("Save", "#save"),
        doubleClick: true,
      });
      await call("hover", { target: await target("Name", "#name") });
      expect(log).toEqual(
        expect.arrayContaining([
          "click save",
          "dblclick save",
          "mouseover name",
        ])
      );
    });

    it("types, replacing the value, and submits with Enter", async () => {
      await call("type", {
        target: await target("Name", "#name"),
        text: "Ada",
        submit: true,
      });
      expect(value("#name")).toBe("Ada");
      expect(log).toContain("submit form");
    });

    it("types slowly, one key at a time", async () => {
      await call("type", {
        target: await target("Email", "#email"),
        text: "ab",
        slowly: true,
      });
      expect(value("#email")).toBe("ab");
      expect(log.filter((entry) => entry === "keydown email")).toHaveLength(2);
    });

    it("fills, checks, unchecks and selects", async () => {
      await call("fill", { target: await target("Name", "#name"), text: "Bo" });
      expect(value("#name")).toBe("Bo");
      await call("check", { target: await target("Agree", "#agree") });
      expect(checked()).toBe(true);
      await call("uncheck", { target: await target("Agree", "#agree") });
      expect(checked()).toBe(false);
      await call("select_option", {
        target: await target("Size", "#size"),
        values: ["m"],
      });
      expect(value("#size")).toBe("m");
    });
  });

  it("passes the click options: double click, button and modifiers", async () => {
    const events: string[] = [];
    document
      .querySelector<HTMLButtonElement>("#save")!
      .addEventListener(
        "mousedown",
        (event) =>
          events.push(`${event.button}${event.shiftKey ? " shift" : ""}`),
        { signal: listening.signal }
      );

    await call("click", { target: "#save", doubleClick: true });
    expect(log).toContain("dblclick save");
    await call("click", {
      target: "#save",
      button: "right",
      modifiers: ["Shift"],
    });

    expect(events.at(-1)).toBe("2 shift");
  });

  it("returns the compact action result from every action", async () => {
    const results = [
      await call("click", { target: "#save" }),
      await call("fill", { target: "#name", text: "Cy" }),
      await call("press_key", { key: "a" }),
      await call("fill_form", {
        fields: [
          { target: "#email", name: "Email", type: "textbox", value: "c@x" },
        ],
      }),
    ];
    for (const result of results)
      expect(result).toMatchObject({
        page_changed: expect.any(Boolean),
        settled: expect.any(Boolean),
      });
  });

  it("fails a selector that matches several elements", async () => {
    await expect(call("click", { target: ".twin" })).resolves.toEqual({
      content: [
        {
          type: "text",
          text: expect.stringContaining(
            "the selector matches 2 elements; it must match exactly one"
          ),
        },
      ],
      isError: true,
    });
    expect(log).not.toContain("click ");
  });

  it("rejects an option it does not support, naming it", async () => {
    await expect(
      call("click", { target: "#save", force: true })
    ).resolves.toMatchObject({
      content: [
        { text: 'ToolInputError: The option "force" is not supported.' },
      ],
      isError: true,
    });
    // A name every object inherits is still not an option.
    await expect(
      call("fill", { target: "#name", text: "Ada", constructor: "x" })
    ).resolves.toMatchObject({
      content: [
        { text: 'ToolInputError: The option "constructor" is not supported.' },
      ],
      isError: true,
    });
    expect(log).not.toContain("click save");
    expect(value("#name")).toBe("Old");
  });

  it("stops fill_form at the first failing field and keeps the fields filled before it", async () => {
    const result = await call("fill_form", {
      fields: [
        { target: "#name", name: "Name", type: "textbox", value: "Dee" },
        { target: "#missing", name: "Phone", type: "textbox", value: "1" },
        { target: "#email", name: "Email", type: "textbox", value: "d@x" },
      ],
    });
    expect(result).toMatchObject({
      result: {
        filled: ["Name"],
        failed: {
          name: "Phone",
          error: expect.stringContaining("matches no element"),
        },
      },
    });
    expect(value("#name")).toBe("Dee");
    expect(value("#email")).toBe("");
  });

  it("fills a checkbox and a combobox through fill_form, by ref or selector", async () => {
    await call("fill_form", {
      fields: [
        {
          target: await refOf("Agree"),
          name: "Agree",
          type: "checkbox",
          value: "true",
        },
        { target: "#size", name: "Size", type: "combobox", value: "Medium" },
      ],
    });
    expect(checked()).toBe(true);
    expect(value("#size")).toBe("m");
  });

  it("presses a key on the focused element", async () => {
    document.querySelector<HTMLInputElement>("#email")!.focus();
    await call("press_key", { key: "z" });
    expect(log).toContain("keydown email");
    expect(value("#email")).toBe("z");
  });

  it("offers each single-element tool to the Goal Loop only for the elements its filter keeps", async () => {
    const targets = await listElementToolTargets();
    const refs = Object.fromEntries(
      await Promise.all(
        ["Name", "Email", "Agree", "Size", "Save"].map(
          async (label) => [label, await refOf(label)] as const
        )
      )
    );
    const offered = (tool: string) =>
      Object.entries(refs)
        .filter(([, ref]) =>
          targets.get(tool)?.some((target) => target === ref)
        )
        .map(([label]) => label);

    expect(offered("check")).toEqual(["Agree"]);
    expect(offered("uncheck")).toEqual(["Agree"]);
    expect(offered("select_option")).toEqual(["Size"]);
    expect(offered("type")).toEqual(["Name", "Email"]);
    expect(offered("fill")).toEqual(["Name", "Email"]);
    for (const tool of ["click", "hover"])
      expect(offered(tool)).toEqual(["Name", "Email", "Agree", "Size", "Save"]);

    const options = buildToolOptions();
    const loopTools = options.map((option) => option.key);
    expect(loopTools).not.toContain("fill_form");
    expect(loopTools).not.toContain("press_key");
    // The loop fills the element and the required fields only.
    expect(
      options
        .find((option) => option.key === "type")!
        .tool.args.map((arg) => arg.name)
    ).toEqual(["target", "text"]);
  });
});

// --- Built-in filters (consumed by the Goal Loop when it offers elements) ---

describe("Browser Tool filters in Chromium", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function fixture(html: string): Element {
    document.body.innerHTML = html;
    const element = document.body.firstElementChild;
    if (!element) throw new Error("Expected a fixture element.");
    return element;
  }

  it("keeps elements with an interactive role for click", () => {
    expect(isClickableElement(fixture("<button>Save</button>"))).toBe(true);
    expect(isClickableElement(fixture('<a href="/next">Next</a>'))).toBe(true);
    expect(isClickableElement(fixture('<div role="button">Go</div>'))).toBe(
      true
    );
  });

  it("keeps elements with a pointer cursor for click", () => {
    expect(
      isClickableElement(fixture('<div style="cursor: pointer">Card</div>'))
    ).toBe(true);
  });

  it("drops plain and disabled elements for click", () => {
    expect(isClickableElement(fixture("<p>Just text</p>"))).toBe(false);
    expect(isClickableElement(fixture("<button disabled>Save</button>"))).toBe(
      false
    );
    expect(
      isClickableElement(fixture('<button aria-disabled="true">Save</button>'))
    ).toBe(false);
    expect(
      isClickableElement(
        fixture('<a role="button" style="cursor: pointer">No href</a>')
      )
    ).toBe(true);
  });

  it("keeps elements that can actually be filled", () => {
    expect(isFillableElement(fixture('<input aria-label="Name">'))).toBe(true);
    expect(
      isFillableElement(fixture('<input type="email" aria-label="Mail">'))
    ).toBe(true);
    expect(isFillableElement(fixture('<textarea aria-label="Note">'))).toBe(
      true
    );
    expect(
      isFillableElement(fixture('<div contenteditable="true">Text</div>'))
    ).toBe(true);
    expect(
      isFillableElement(
        fixture('<div contenteditable="plaintext-only">Text</div>')
      )
    ).toBe(true);
  });

  it("drops elements that cannot be filled", () => {
    expect(isFillableElement(fixture("<button>Save</button>"))).toBe(false);
    expect(
      isFillableElement(fixture('<input type="checkbox" aria-label="Done">'))
    ).toBe(false);
    expect(
      isFillableElement(fixture('<input readonly aria-label="Name">'))
    ).toBe(false);
    expect(
      isFillableElement(fixture('<input disabled aria-label="Name">'))
    ).toBe(false);
  });

  it("keeps checkboxes and radio buttons for check and uncheck", () => {
    expect(isCheckableElement(fixture('<input type="checkbox">'))).toBe(true);
    expect(isCheckableElement(fixture('<input type="radio">'))).toBe(true);
    expect(isCheckableElement(fixture('<div role="switch">On</div>'))).toBe(
      true
    );
    expect(isCheckableElement(fixture('<input type="text">'))).toBe(false);
    expect(
      isCheckableElement(fixture('<input type="checkbox" disabled>'))
    ).toBe(false);
  });

  it("keeps checkboxes but not radio buttons for uncheck", () => {
    expect(isUncheckableElement(fixture('<input type="checkbox">'))).toBe(true);
    expect(isUncheckableElement(fixture('<input type="radio">'))).toBe(false);
  });

  it("keeps select elements for select_option", () => {
    expect(
      isSelectElement(fixture("<select><option>A</option></select>"))
    ).toBe(true);
    expect(
      isSelectElement(fixture("<select disabled><option>A</option></select>"))
    ).toBe(false);
    expect(isSelectElement(fixture('<div role="combobox">A</div>'))).toBe(
      false
    );
  });
});
