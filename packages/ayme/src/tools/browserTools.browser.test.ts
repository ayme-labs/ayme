import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Page } from "@playwright/test";

import { createPage, registerCompiledPom } from "../page-objects";
import type { PomManifest } from "../shared";
import {
  isCheckableElement,
  isClickableElement,
  isFillableElement,
  isSelectElement,
  isUncheckableElement,
} from "./browserTools";
import { errorText } from "../shared";
import { buildToolOptions } from "../goal-loop";
import {
  FILL_SCHEMA,
  PLAYWRIGHT_MCP_COUNTERPARTS,
  PLAYWRIGHT_MCP_SCHEMAS,
  shapeOf,
  withoutElement,
} from "./playwrightMcp.testSupport";
import { agentTools } from "../test-utils/publication.testSupport";
import { lookAtPageStateForDocument } from "../page-state";
import { createAyme, listElementToolTargets, type Ayme } from "../runtime";
import { rooted } from "../test-utils/pomRoot.testSupport";

type Schema = {
  type?: string;
  description?: string;
  additionalProperties?: unknown;
  items?: Schema;
  properties?: Record<string, Schema>;
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

/**
 * Two Page Object Roots Playwright's snapshot gives no ref, so `snapshot`
 * prints each as `s_…`: a plain wrapper and one with a pointer cursor.
 */
const ROOTS = `
  <div id="account" role="none"><button type="button">Save changes</button></div>
  <div id="card" role="none" style="cursor: pointer"><button type="button">Open card</button></div>
`;

class RootsPage {
  readonly account;
  readonly card;
  constructor(page: Page) {
    this.account = rooted(page.locator("#account"), {});
    this.card = rooted(page.locator("#card"), {});
  }
}

const rootsManifest: PomManifest = {
  className: "RootsPage",
  members: ["account", "card"].map((memberName) => ({
    memberName,
    kind: "component",
    access: "field",
    componentClassName: "Root",
    collection: false,
  })),
  tools: [],
  components: [
    {
      className: "Root",
      members: [{ memberName: "root", kind: "locator", access: "field" }],
      tools: [],
    },
  ],
};
registerCompiledPom(RootsPage, rootsManifest);

describe("Browser Tools in Chromium", () => {
  let ayme: Ayme;
  let stop: () => void;
  let listening: AbortController;
  const log: string[] = [];

  beforeEach(() => {
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
    ayme = createAyme({
      pageFactory: () => createPage({ actionTimeout: 500 }),
    });
    stop = ayme.start();
  });

  afterEach(() => {
    listening.abort();
    stop();
    document.body.innerHTML = "";
  });

  const call = (name: string, input: unknown) => agentTools().call(name, input);

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
    const tools = new Map(ayme.tools.list().map((tool) => [tool.name, tool]));
    for (const name of BROWSER_TOOLS) expect(tools.has(name), name).toBe(true);
    for (const [name, counterpart] of Object.entries(
      PLAYWRIGHT_MCP_COUNTERPARTS
    ))
      expect(shapeOf(tools.get(name)!.inputSchema), name).toEqual(
        withoutElement(PLAYWRIGHT_MCP_SCHEMAS[counterpart])
      );
    expect(shapeOf(tools.get("fill")!.inputSchema)).toEqual(FILL_SCHEMA);
  });

  it("describes every field of the Browser Tools' input schemas to the agent", () => {
    const tools = new Map(ayme.tools.list().map((tool) => [tool.name, tool]));
    const undescribed = (schema: Schema, path: string): string[] =>
      Object.entries(schema.properties ?? {}).flatMap(([name, property]) => [
        ...(property.description ? [] : [`${path}.${name}`]),
        ...undescribed(property, `${path}.${name}`),
        ...(property.items
          ? undescribed(property.items, `${path}.${name}[]`)
          : []),
      ]);
    expect(
      BROWSER_TOOLS.flatMap((name) =>
        undescribed(tools.get(name)!.inputSchema as Schema, name)
      )
    ).toEqual([]);
  });

  it("closes every object in the Browser Tools' input schemas, as their input checks refuse unknown options", () => {
    const tools = new Map(ayme.tools.list().map((tool) => [tool.name, tool]));
    const openObjects = (schema: Schema, path: string): string[] => [
      ...(schema.type === "object" && schema.additionalProperties !== false
        ? [path]
        : []),
      ...(schema.items ? openObjects(schema.items, `${path}[]`) : []),
      ...Object.entries(schema.properties ?? {}).flatMap(([name, property]) =>
        openObjects(property, `${path}.${name}`)
      ),
    ];
    expect(
      BROWSER_TOOLS.flatMap((name) =>
        openObjects(tools.get(name)!.inputSchema as Schema, name)
      )
    ).toEqual([]);
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

  it("takes a target as a Structural Ref only when all of it is one", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<button id="save1" type="button">Save one</button><e1-box id="box">Box</e1-box>'
    );

    // Each selector holds a ref-like `e1`, at its end or at its start.
    await call("click", { target: "#save1" });
    await call("click", { target: "e1-box" });
    await call("click", { target: 'role=button[name="Save one"]' });
    await call("click", { target: "text=Box" });
    expect(log).toEqual(
      expect.arrayContaining([
        "click save1",
        "click box",
        "click save1",
        "click box",
      ])
    );
    await expect(call("click", { target: "s_root" })).rejects.toThrow(
      'Cannot click ref "s_root": no snapshot of the current document issued it'
    );
  });

  /** The synthetic ref `text` prints for the RootsPage member's root. */
  function rootRef(text: string, member: string) {
    const ref = text.match(
      new RegExp(`(s_\\w+) RootsPage\\.${member}\\b`)
    )?.[1];
    if (!ref) throw new Error(`Expected a synthetic ref for ${member}.`);
    return ref;
  }

  it("clicks a Page Object Root through its synthetic ref", async () => {
    document.body.insertAdjacentHTML("beforeend", ROOTS);
    ayme.pom.register(RootsPage);
    const { structure } = (await call("snapshot", {})) as {
      structure: string;
    };

    await call("click", { target: rootRef(structure, "account") });

    expect(log).toContain("click account");
  });

  it("clicks the root a look's synthetic ref shows once an earlier root is gone", async () => {
    document.body.insertAdjacentHTML("beforeend", ROOTS);
    ayme.pom.register(RootsPage);
    await call("snapshot", {});
    document.getElementById("account")!.remove();
    // The Inspector runs a tool on a ref its unrecorded look printed.
    const look = await lookAtPageStateForDocument(document);

    await call("click", { target: rootRef(look.text, "card") });

    expect(log).toContain("click card");
  });

  it("fills an element that receives no pointer events through its ref", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<input id="locked" aria-label="Locked" style="pointer-events: none">'
    );

    await call("fill", { target: await refOf("Locked"), text: "open" });

    expect(value("#locked")).toBe("open");
  });

  it("clicks an element inside an open shadow root through its ref", async () => {
    document.body.insertAdjacentHTML("beforeend", '<div id="host"></div>');
    const shadow = document
      .getElementById("host")!
      .attachShadow({ mode: "open" });
    shadow.innerHTML = '<button id="inner">Shadowed</button>';
    let clicked = false;
    shadow.getElementById("inner")!.addEventListener("click", () => {
      clicked = true;
    });

    await call("click", { target: await refOf("Shadowed") });

    expect(clicked).toBe(true);
  });

  it("fails a selector that matches several elements", async () => {
    await expect(call("click", { target: ".twin" })).rejects.toThrow(
      "the selector matches 2 elements; it must match exactly one"
    );
    expect(log).not.toContain("click ");
  });

  it("rejects a locator expression from generate_locator, saying what to pass", async () => {
    expect(
      await call("click", {
        target: "getByRole('button', { name: 'Save' })",
      }).catch(errorText)
    ).toBe(
      `ToolInputError: Cannot click "getByRole('button', { name: 'Save' })": it is a Playwright locator expression, which tools do not take.`
    );
    expect(log).not.toContain("click save");
  });

  it.each([
    "root.getByRole('button', { name: 'Save' })",
    "this.page.locator('#save')",
    "page.frameLocator('iframe').getByRole('button')",
    "locator('#save').first()",
    "await page.getByText('Save')",
  ])(
    "rejects the chained locator expression %s the same way",
    async (target) => {
      expect(await call("click", { target }).catch(errorText)).toBe(
        `ToolInputError: Cannot click "${target}": it is a Playwright locator expression, which tools do not take.`
      );
      expect(log).not.toContain("click save");
    }
  );

  it.each([
    ["[ref=e1]", 'Cannot click "[ref=e1]": the selector matches no element.'],
    [" e1 ", 'Cannot click " e1 ": the selector matches no element.'],
    ["E1", 'Cannot click "E1": the selector matches no element.'],
    [
      "ref=e1",
      'ToolInputError: Cannot click "ref=e1": it is neither a Structural Ref nor a selector this runtime supports:',
    ],
  ])(
    "names the ref to pass when the target %j is a ref written another way",
    async (target, failure) => {
      const text = await call("click", { target }).catch(errorText);
      expect(text).toContain(failure);
      expect(text).toMatch(/ It writes the Structural Ref e1 another way\.$/);
    }
  );

  it("gives no ref hint for a real selector, or when a selector matches several elements", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<button type="button" ref="e1">One</button><button type="button" ref="e1">Two</button>'
    );

    expect(await call("click", { target: "[e1]" }).catch(errorText)).toBe(
      'RefResolutionError: Cannot click "[e1]": the selector matches no element.'
    );
    expect(await call("click", { target: "[ref=e1]" }).catch(errorText)).toBe(
      'RefResolutionError: Cannot click "[ref=e1]": the selector matches 2 elements; it must match exactly one.'
    );
  });

  it("rejects an option it does not support, naming it and every other problem", async () => {
    expect(
      await call("click", { target: "#save", force: true }).catch(errorText)
    ).toBe("ToolInputError: Input property force is not supported.");
    // A name every object inherits is still not an option.
    expect(
      await call("fill", {
        target: "#name",
        text: "Ada",
        constructor: "x",
      }).catch(errorText)
    ).toBe("ToolInputError: Input property constructor is not supported.");
    expect(
      await call("fill", { target: "#name", force: true }).catch(errorText)
    ).toBe(
      "ToolInputError: Input property force is not supported. Input property text is required."
    );
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

  it.each([
    ["an unparsable selector", "input[placeholder="],
    ["a locator expression", "getByRole('textbox')"],
  ])("names the field when its target is %s", async (_kind, target) => {
    const result = await call("fill_form", {
      fields: [{ target, name: "New item", type: "textbox", value: "x" }],
    });
    expect(result).toMatchObject({
      result: {
        failed: {
          name: "New item",
          error: expect.stringContaining(
            `Cannot fill the field "New item" at "${target}": it is `
          ),
        },
      },
    });
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

  it("offers a Page Object Root's synthetic ref by the tool's filter alone", async () => {
    document.body.insertAdjacentHTML("beforeend", ROOTS);
    ayme.pom.register(RootsPage);
    const look = await lookAtPageStateForDocument(document);
    const targets = await listElementToolTargets(look);

    expect(targets.get("click")).toContain(rootRef(look.text, "card"));
    expect(targets.get("click")).not.toContain(rootRef(look.text, "account"));
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

  it("keeps exactly the input types Playwright fills", () => {
    const fillable = (type: string) =>
      isFillableElement(fixture(`<input type="${type}">`));
    expect(
      [
        "color",
        "date",
        "datetime-local",
        "email",
        "month",
        "number",
        "password",
        "range",
        "search",
        "tel",
        "text",
        "time",
        "url",
        "week",
      ].filter((type) => !fillable(type))
    ).toEqual([]);
    expect(
      [
        "button",
        "checkbox",
        "file",
        "hidden",
        "image",
        "radio",
        "reset",
        "submit",
      ].filter(fillable)
    ).toEqual([]);
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
