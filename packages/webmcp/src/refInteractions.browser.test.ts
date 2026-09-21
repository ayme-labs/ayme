import { afterEach, describe, expect, it } from "vitest";
import { AriaRefSchema } from "@ayme-dev/core/structural-observation";

import ayme from "./index";
import { createPage } from "./browserPage";
import {
  createAymeRuntime,
  registerCompiledPom,
  registerPageObject,
  listRegisteredPomTools,
} from "./registry";

describe("Structural Ref interactions in Chromium", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
    document.head.querySelector("#ref-interaction-styles")?.remove();
  });

  it("reports page_changed after a click that opens a dialog following a CSS transition", async () => {
    document.head.insertAdjacentHTML(
      "beforeend",
      `<style id="ref-interaction-styles">
        #confirm {
          opacity: 0;
          transition: opacity 300ms;
        }
        #confirm.open {
          opacity: 1;
        }
      </style>`
    );
    document.body.innerHTML =
      '<button id="open">Open dialog</button><div id="confirm" role="dialog" aria-label="Confirm action" hidden><p>Are you sure?</p></div>';
    const open = document.querySelector<HTMLButtonElement>("#open");
    const dialog = document.querySelector<HTMLDivElement>("#confirm");
    if (!open || !dialog) throw new Error("Expected dialog fixture elements.");
    open.addEventListener("click", () => {
      dialog.hidden = false;
      dialog.classList.add("open");
    });

    const runtime = createAymeRuntime(createPage());
    try {
      const state = await ayme.getPageState();
      const openRef = structuralRefFor(state.text, "Open dialog");
      const result = await ayme.click(openRef);
      expect(result.page_changed).toBe(true);
      expect(result.settled).toBe(true);
      expect(result.changes).toBeDefined();
      expect(result.changes).toContain("<added>");
      expect(result.changes).toContain("dialog");
      expect(result.changes).toContain("Confirm action");
    } finally {
      runtime.dispose();
    }
  });

  it("waits for async attribute-only mutations before reporting settled", async () => {
    document.body.innerHTML =
      '<button id="attribute-only">Attribute-only</button>';
    const button = document.querySelector<HTMLButtonElement>("#attribute-only");
    if (!button) throw new Error("Expected attribute-only button.");

    button.addEventListener("click", () => {
      window.setTimeout(() => {
        button.setAttribute("aria-label", "Phase one");
      }, 150);
      window.setTimeout(() => {
        button.setAttribute("aria-label", "Phase two");
      }, 300);
    });

    const runtime = createAymeRuntime(createPage());
    try {
      const state = await ayme.getPageState();
      const buttonRef = structuralRefFor(state.text, "Attribute-only");
      const result = await ayme.click(buttonRef);
      expect(result.page_changed).toBe(true);
      expect(result.settled).toBe(true);
      expect(button.getAttribute("aria-label")).toBe("Phase two");
    } finally {
      runtime.dispose();
    }
  });

  it("reports page_changed false when a click does nothing", async () => {
    document.body.innerHTML = '<button id="noop">No-op</button>';
    const page = createPage();
    await page.locator("#noop").focus();
    const runtime = createAymeRuntime(page);
    try {
      const state = await ayme.getPageState();
      const noopRef = structuralRefFor(state.text, "No-op");
      const result = await ayme.click(noopRef);
      expect(result.page_changed).toBe(false);
      expect(result.settled).toBe(true);
      expect(result.changes).toBeUndefined();
    } finally {
      runtime.dispose();
    }
  });

  it("reports settled false when the page never stops changing", async () => {
    document.body.innerHTML = '<button id="start">Start churn</button>';
    const start = document.querySelector<HTMLButtonElement>("#start");
    if (!start) throw new Error("Expected churn button.");
    let interval: number | undefined;
    start.addEventListener("click", () => {
      interval = window.setInterval(() => {
        const marker = document.createElement("span");
        marker.textContent = "x";
        document.body.append(marker);
      }, 50);
    });

    const runtime = createAymeRuntime(createPage());
    try {
      const state = await ayme.getPageState();
      const startRef = structuralRefFor(state.text, "Start churn");
      const result = await ayme.click(startRef);
      expect(result.page_changed).toBe(true);
      expect(result.settled).toBe(false);
    } finally {
      if (interval !== undefined) window.clearInterval(interval);
      runtime.dispose();
    }
  });

  it("includes the removed subtree in changes when a click removes an item", async () => {
    document.body.innerHTML = `
      <ul>
        <li id="apple">Apple</li>
        <li id="banana">Banana</li>
      </ul>
      <button id="remove">Remove Apple</button>
    `;
    const removeButton = document.querySelector<HTMLButtonElement>("#remove");
    const apple = document.querySelector("#apple");
    if (!removeButton || !apple)
      throw new Error("Expected list fixture elements.");
    removeButton.addEventListener("click", () => apple.remove());

    const runtime = createAymeRuntime(createPage());
    try {
      const state = await ayme.getPageState();
      const removeRef = structuralRefFor(state.text, "Remove Apple");
      const result = await ayme.click(removeRef);
      expect(result.page_changed).toBe(true);
      expect(result.changes).toBeDefined();
      expect(result.changes).toContain("<removed>");
      expect(result.changes).toContain("Apple");
    } finally {
      runtime.dispose();
    }
  });

  it("includes the updated node in changes when a click changes a label", async () => {
    document.body.innerHTML = '<button id="toggle">Toggle label</button>';
    const button = document.querySelector<HTMLButtonElement>("#toggle");
    if (!button) throw new Error("Expected toggle button.");
    button.addEventListener("click", () => {
      button.textContent = "Toggled";
    });

    const runtime = createAymeRuntime(createPage());
    try {
      const state = await ayme.getPageState();
      const toggleRef = structuralRefFor(state.text, "Toggle label");
      const result = await ayme.click(toggleRef);
      expect(result.page_changed).toBe(true);
      expect(result.changes).toBeDefined();
      expect(result.changes).toContain("<changed>");
    } finally {
      runtime.dispose();
    }
  });

  it("returns a JSON value under result from a POM action", async () => {
    document.body.innerHTML = '<div id="app"><span>Count: 0</span></div>';

    class CounterPage {
      constructor(readonly page: unknown) {}
      getCount() {
        return { total: 42 };
      }
    }
    registerCompiledPom(CounterPage, {
      className: "CounterPage",
      members: [],
      components: [],
      tools: [
        {
          methodName: "getCount",
          toolName: "getCount",
          description: "Get the current count.",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
          parameters: [],
          returnPoms: [],
        },
      ],
    });

    const runtime = createAymeRuntime(createPage());
    try {
      const instance = new CounterPage(undefined);
      registerPageObject(CounterPage, instance);

      const tool = listRegisteredPomTools().find((t) => t.name === "getCount");
      if (!tool) throw new Error("Expected the getCount tool.");
      const result = await tool.execute({});
      expect(result).toMatchObject({
        page_changed: false,
        settled: true,
        result: { total: 42 },
      });
    } finally {
      runtime.dispose();
    }
  });

  it("drops a non-JSON return value from a POM action", async () => {
    document.body.innerHTML = '<div id="app"><span>Content</span></div>';

    const nonJsonValue = { nested: document.createElement("div") };
    class PageObjectPage {
      constructor(readonly page: unknown) {}
      getElement() {
        return nonJsonValue;
      }
    }
    registerCompiledPom(PageObjectPage, {
      className: "PageObjectPage",
      members: [],
      components: [],
      tools: [
        {
          methodName: "getElement",
          toolName: "getElement",
          description: "Get an element.",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
          parameters: [],
          returnPoms: [],
        },
      ],
    });

    const runtime = createAymeRuntime(createPage());
    try {
      const instance = new PageObjectPage(undefined);
      registerPageObject(PageObjectPage, instance);

      const tool = listRegisteredPomTools().find(
        (t) => t.name === "getElement"
      );
      if (!tool) throw new Error("Expected the getElement tool.");
      const result = (await tool.execute({})) as Record<string, unknown>;
      expect(result.page_changed).toBe(false);
      expect(result.settled).toBe(true);
      expect(result.result).toBeUndefined();
    } finally {
      runtime.dispose();
    }
  });
});

function structuralRefFor(
  text: string,
  accessibleName: string,
  role = "button"
) {
  const escapedName = accessibleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ref = text.match(
    new RegExp(`(?:^|\\s)(e\\d+) ${role} "${escapedName}"`)
  )?.[1];
  if (!ref) throw new Error(`Expected a Structural Ref for ${accessibleName}.`);
  return AriaRefSchema.parse(ref);
}
