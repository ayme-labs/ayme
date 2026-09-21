import { afterEach, describe, expect, it } from "vitest";
import { AriaRefSchema } from "@ayme-dev/core/structural-observation";

import ayme from "./index";
import { createPage } from "./browserPage";
import { createAymeRuntime } from "./registry";

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
      await expect(ayme.click(openRef)).resolves.toEqual({
        page_changed: true,
        settled: true,
      });
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
      await expect(ayme.click(buttonRef)).resolves.toEqual({
        page_changed: true,
        settled: true,
      });
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
      await expect(ayme.click(noopRef)).resolves.toEqual({
        page_changed: false,
        settled: true,
      });
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
      await expect(ayme.click(startRef)).resolves.toEqual({
        page_changed: true,
        settled: false,
      });
    } finally {
      if (interval !== undefined) window.clearInterval(interval);
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
