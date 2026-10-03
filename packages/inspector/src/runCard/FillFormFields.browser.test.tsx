import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { ControlState } from "../adapter/formControls";
import type { RunnableTool } from "../adapter/runnableTools";
import { buildStructureTree } from "../adapter/structure";
import type { Run } from "../adapter/useRuns";
import { renderPart } from "../renderPart";
import { RunCard as RunCardPart } from "../testing";
import { RunCard } from "./RunCard";

// Component tests: fill_form's form in a run card, built from a fixture
// page structure and driven through the run card's page object on
// playwright-lite. Each checks what the form shows and what it asks to run.

const page = createPage();
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

const fillForm: RunnableTool = {
  name: "fill_form",
  action: "fill_form",
  description: "Fill several form fields in one call, in order.",
  available: true,
  fillForm: true,
  argumentsSchema: {
    type: "object",
    properties: { fields: { type: "array", items: { type: "object" } } },
    required: ["fields"],
  },
};

const pageState = `- e2 main:
  - e3 form "Sign up":
    - e4 textbox "Name": Ada
    - e5 textbox "Email"
    - e6 checkbox "Agree" [checked]
    - e7 group "Plan":
      - e8 radio "Free" [checked]
      - e9 radio "Pro"
    - e10 combobox "Country":
      - e11 option "Hungary" [selected]
      - e12 option "Germany"
    - e13 slider "Seats": 1
    - e14 button "Create account"`;

const controls = new Map<string, ControlState>([
  ["e13", { value: "1", range: { min: 1, max: 20, step: 1 } }],
]);

type Look = { text: string; controls?: Map<string, ControlState> };

function renderCard({ runs = [] }: { runs?: Run[] } = {}) {
  const onRun = vi.fn();
  const onPreview = vi.fn();
  let showPage: (look: Look) => void = () => {};
  let showRuns: (runs: Run[]) => void = () => {};

  function Harness() {
    const [look, setLook] = useState<Look>({ text: pageState, controls });
    const [shownRuns, setShownRuns] = useState(runs);
    showPage = setLook;
    showRuns = setShownRuns;
    const { roots } = buildStructureTree(
      look.text,
      new Map(),
      undefined,
      look.controls
    );
    return (
      <RunCard
        tool={fillForm}
        available
        head={false}
        refSource={{ roots, onPreview, onPreviewEnd: () => {} }}
        runs={shownRuns}
        onRun={onRun}
        onShowRun={() => {}}
      />
    );
  }

  unmounts.push(renderPart(<Harness />));
  const card = new RunCardPart(
    page.getByRole("form", { name: "fill_form", exact: true })
  );
  return {
    card,
    form: card.fillForm(),
    onRun,
    onPreview,
    showPage: (look: Look) => showPage(look),
    showRuns: (shown: Run[]) => showRuns(shown),
  };
}

/** The fields the last run asked to fill. */
function sentFields(onRun: ReturnType<typeof vi.fn>) {
  return (onRun.mock.lastCall?.[0] as { fields: unknown[] }).fields;
}

describe("the list", () => {
  it("shows every fillable element in page order, holding the page's value", async () => {
    const { card, form } = renderCard();

    await expect
      .poll(() => form.names())
      .toEqual(["Name", "Email", "Agree", "Plan", "Country", "Seats"]);
    expect(await form.control("Name").inputValue()).toBe("Ada");
    expect(await form.control("Email").inputValue()).toBe("");
    expect(await form.control("Agree").isChecked()).toBe(true);
    expect(
      await form
        .control("Plan")
        .getByRole("radio", { name: "Free" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(await form.control("Country").inputValue()).toBe("Hungary");
    expect(await form.control("Seats").inputValue()).toBe("1");
    expect(await card.jsonEditor.count()).toBe(0);
    expect(await form.changed()).toEqual([]);
  });

  it("follows the page in the rows the person hasn't changed", async () => {
    const { form, showPage } = renderCard();
    await form.set("Email", "ada@example.com");

    showPage({
      text: pageState
        .replace('"Name": Ada', '"Name": Grace')
        .replace('"Email"', '"Email": old@example.com'),
      controls,
    });

    await expect.poll(() => form.control("Name").inputValue()).toBe("Grace");
    expect(await form.control("Email").inputValue()).toBe("ada@example.com");
    expect(await form.changed()).toEqual(["Email"]);
  });

  it("highlights a row's element while it's hovered", async () => {
    const { form, onPreview } = renderCard();

    await form.row("Country").hover();

    expect(onPreview).toHaveBeenLastCalledWith("e10");
  });
});

describe("running", () => {
  it("sends only the changed rows, in list order", async () => {
    const { card, form, onRun } = renderCard();

    await form.set("Country", "Germany");
    await form.set("Name", "Grace");
    await form.set("Plan", "Pro");
    await form.set("Seats", "5");
    await card.runButton.click();

    expect(sentFields(onRun)).toEqual([
      { target: "e4", name: "Name", type: "textbox", value: "Grace" },
      { target: "e9", name: "Pro", type: "radio", value: "true" },
      { target: "e10", name: "Country", type: "combobox", value: "Germany" },
      { target: "e13", name: "Seats", type: "slider", value: "5" },
    ]);
  });

  it("clears a textbox by emptying it and unchecks a checkbox by unticking it", async () => {
    const { card, form, onRun } = renderCard();

    await form.set("Name", "");
    await form.set("Agree", false);
    await card.runButton.click();

    expect(sentFields(onRun)).toEqual([
      { target: "e4", name: "Name", type: "textbox", value: "" },
      { target: "e6", name: "Agree", type: "checkbox", value: "false" },
    ]);
  });

  it("marks no row once the page shows the values filled", async () => {
    const { form, showPage } = renderCard();
    await form.set("Name", "Grace");
    await form.set("Agree", false);

    showPage({
      text: pageState
        .replace('"Name": Ada', '"Name": Grace')
        .replace('"Agree" [checked]', '"Agree"'),
      controls,
    });

    await expect.poll(() => form.changed()).toEqual([]);
    expect(await form.control("Name").inputValue()).toBe("Grace");
  });

  it("marks the row of the field the run couldn't fill", async () => {
    const { form, showRuns } = renderCard();
    await form.set("Name", "Grace");
    await form.set("Country", "Germany");

    showRuns([
      {
        id: 1,
        toolName: "fill_form",
        arguments: {
          fields: [
            { target: "e4", name: "Name", type: "textbox", value: "Grace" },
            {
              target: "e10",
              name: "Country",
              type: "combobox",
              value: "Germany",
            },
          ],
        },
        status: "succeeded",
        result: JSON.stringify({
          filled: ["Name"],
          failed: { name: "Country", error: "The select is disabled." },
        }),
        startedAt: 0,
        durationMs: 5,
        steps: [],
      },
    ]);

    await expect.poll(() => form.failed("Country")).toBe(true);
    expect(await form.failed("Name")).toBe(false);
    expect(await form.row("Country").textContent()).toContain(
      "The select is disabled."
    );
  });
});

describe("undo", () => {
  it("unmarks a row set back to the page's value, or undone", async () => {
    const { form } = renderCard();
    await form.set("Name", "Grace");
    await form.set("Email", "ada@example.com");
    await form.set("Agree", false);

    await form.set("Name", "Ada");
    await form.undo("Email");

    expect(await form.changed()).toEqual(["Agree"]);
    expect(await form.control("Email").inputValue()).toBe("");
  });

  it("undoes every change at once", async () => {
    const { form } = renderCard();
    await form.set("Name", "Grace");
    await form.set("Plan", "Pro");

    await form.undoAllButton.click();

    expect(await form.changed()).toEqual([]);
    expect(await form.control("Name").inputValue()).toBe("Ada");
    expect(await form.changedCount.textContent()).toBe("0 changed");
  });
});

describe("fill order", () => {
  it("follows the rows dragged into a new order", async () => {
    const { card, form, onRun } = renderCard();
    await form.set("Name", "Grace");
    await form.set("Country", "Germany");

    await form.drag("Country", "Name");

    await expect
      .poll(() => form.names())
      .toEqual(["Country", "Name", "Email", "Agree", "Plan", "Seats"]);
    expect(await form.fillOrder("Country").textContent()).toBe("1");
    expect(await form.fillOrder("Name").textContent()).toBe("2");
    await card.runButton.click();
    expect(
      sentFields(onRun).map((field) => (field as { name: string }).name)
    ).toEqual(["Country", "Name"]);
  });
});
