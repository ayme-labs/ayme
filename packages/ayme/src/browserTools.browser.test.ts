import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPage } from "./browserPage";
import { buildToolOptions } from "./goalLoopQuestions";
import {
  EXTRA_BROWSER_TOOL_SCHEMAS,
  PLAYWRIGHT_MCP_COUNTERPARTS,
  PLAYWRIGHT_MCP_SCHEMAS,
  shapeOf,
} from "./playwrightMcp.testSupport";
import { listRefToolTargets } from "./publishedTools";
import { createRuntimeSession } from "./runtime";
import { synchronizeWebMcpTools } from "./webMcp";

type PublishedTool = {
  name: string;
  inputSchema: unknown;
  execute(input: unknown): Promise<unknown>;
};

const BROWSER_TOOLS = [
  "click",
  "dblclick",
  "hover",
  "type",
  "fill",
  "fill_form",
  "check",
  "uncheck",
  "select_option",
  "press_key",
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
    const session = createRuntimeSession({
      pageFactory: () => createPage({ actionTimeout: 500 }),
    });
    stop = session.start();
    tools = new Map();
    const publication = await synchronizeWebMcpTools({
      async registerTool(tool: PublishedTool) {
        tools.set(tool.name, tool);
      },
    } as never);
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

  it("publishes the ten Browser Tools with Playwright MCP's input fields", () => {
    for (const name of BROWSER_TOOLS) expect(tools.has(name), name).toBe(true);
    for (const [name, counterpart] of Object.entries(
      PLAYWRIGHT_MCP_COUNTERPARTS
    ))
      expect(shapeOf(tools.get(name)!.inputSchema), name).toEqual(
        PLAYWRIGHT_MCP_SCHEMAS[counterpart]
      );
    for (const [name, schema] of Object.entries(EXTRA_BROWSER_TOOL_SCHEMAS))
      expect(shapeOf(tools.get(name)!.inputSchema), name).toEqual(schema);
  });

  describe.each([
    ["a Structural Ref", (label: string) => refOf(label)],
    ["a selector", async (_label: string, selector: string) => selector],
  ])("addressed by %s", (_kind, target) => {
    it("clicks, double-clicks and hovers", async () => {
      await call("click", { target: await target("Save", "#save") });
      await call("dblclick", { target: await target("Save", "#save") });
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
    expect(log).not.toContain("click save");
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

  it("fills a checkbox and a combobox through fill_form", async () => {
    await call("fill_form", {
      fields: [
        { target: "#agree", name: "Agree", type: "checkbox", value: "true" },
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
    const targets = await listRefToolTargets();
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
    for (const tool of ["click", "dblclick", "hover"])
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
