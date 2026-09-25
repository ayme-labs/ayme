import { describe, expect, it } from "vitest";

import ayme, { RefResolutionError } from "./index";
import { AriaRefSchema } from "@ayme-dev/core/structural-observation";
import { createPage as createPlaywrightLitePage } from "@ayme-dev/playwright-lite";
import { createPage } from "./browserPage";
import { createAymeRuntime } from "./registry";

describe("the public Ayme page state facade in Chromium", () => {
  it("resolves live elements and retargets historical refs through replacements", async () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const originalState = await ayme.getPageState();
    const originalRef = structuralRefFor(originalState.text, "Save changes");
    const observedRefs = [originalRef];
    let previousElement = document.querySelector("#save");
    if (!previousElement) throw new Error("Expected the original button.");

    for (let replacement = 0; replacement < 3; replacement += 1) {
      const nextElement = document.createElement("button");
      nextElement.id = "save";
      nextElement.textContent = "Save changes";
      previousElement.replaceWith(nextElement);

      const currentState = await ayme.getPageState();
      const currentRef = structuralRefFor(currentState.text, "Save changes");
      expect(currentRef).not.toBe(observedRefs.at(-1));
      observedRefs.push(currentRef);
      previousElement = nextElement;
    }

    const latestRef = observedRefs.at(-1)!;
    const resolutions = await originalState.resolve(...observedRefs);
    expect(resolutions).toEqual(
      observedRefs.map((requestedRef) => ({
        status: "resolved",
        requestedRef,
        node: { ref: latestRef, element: previousElement },
      }))
    );

    previousElement.toggleAttribute("hidden", true);
    await expect(originalState.resolve(originalRef)).resolves.toEqual([
      {
        status: "unresolved",
        requestedRef: originalRef,
        reason: "removed",
      },
    ]);

    previousElement.toggleAttribute("hidden", false);
    await expect(originalState.resolve(originalRef)).resolves.toEqual([
      {
        status: "resolved",
        requestedRef: originalRef,
        node: { ref: latestRef, element: previousElement },
      },
    ]);

    previousElement.remove();
    await expect(originalState.resolve(originalRef)).resolves.toEqual([
      {
        status: "unresolved",
        requestedRef: originalRef,
        reason: "removed",
      },
    ]);

    document.body.append(previousElement);
    await expect(originalState.resolve(originalRef)).resolves.toEqual([
      {
        status: "resolved",
        requestedRef: originalRef,
        node: { ref: latestRef, element: previousElement },
      },
    ]);
  });

  it("clicks and fills real elements addressed by page-state refs", async () => {
    document.body.innerHTML =
      '<button id="save">Save changes</button><input id="name" aria-label="Name">';
    const runtime = createAymeRuntime(createPage());
    try {
      const state = await ayme.getPageState();
      const saveRef = structuralRefFor(state.text, "Save changes");
      const nameRef = structuralRefFor(state.text, "Name", "textbox");
      const button = document.querySelector("#save");
      const input = document.querySelector<HTMLInputElement>("#name");
      if (!button || !input) throw new Error("Expected the form controls.");
      let clicks = 0;
      button.addEventListener("click", () => clicks++);

      await ayme.click(saveRef);
      await ayme.fill(nameRef, "Updated name");

      expect(clicks).toBe(1);
      expect(input.value).toBe("Updated name");
    } finally {
      runtime.dispose();
    }
  });

  it("rejects click and fill with the thrown error", async () => {
    document.body.innerHTML =
      '<button id="save">Save changes</button><input id="name" aria-label="Name">' +
      '<div style="position: fixed; inset: 0"></div>';
    const runtime = createAymeRuntime(
      createPlaywrightLitePage({ actionTimeout: 1000 })
    );
    try {
      const state = await ayme.getPageState();
      const saveRef = structuralRefFor(state.text, "Save changes");
      const nameRef = structuralRefFor(state.text, "Name", "textbox");

      const clickError = await ayme.click(saveRef).catch((error) => error);
      expect(clickError).toBeInstanceOf(Error);
      expect(clickError.name).toBe("TimeoutError");
      expect(clickError.message).toMatch(/^page\.click: Timeout 1000ms/);

      document.querySelector("#name")!.remove();
      const fillError = await ayme
        .fill(nameRef, "Updated name")
        .catch((error) => error);
      expect(fillError).toBeInstanceOf(RefResolutionError);
      expect(fillError.message).toBe(`Cannot fill ref "${nameRef}": removed.`);
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
