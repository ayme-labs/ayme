import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { ProjectedStructuralNodeForest } from "@ayme-dev/ayme/internal";

import type { ControlState } from "../shared/infrastructure/formControls";
import type { RunnableTool } from "../adapter/runnableTools";
import { forest, node } from "../structure/test-utils/projected";
import { buildStructureTree } from "../structure/domain/structure";
import type { Run } from "../runs/infrastructure/useRuns";
import { renderPart } from "../testing/renderPart";
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

/** The sign-up form's page state, with the values and radios it shows. */
function signUp({
  name = "Ada",
  email,
  agreed = true,
  pro = true,
}: { name?: string; email?: string; agreed?: boolean; pro?: boolean } = {}) {
  return forest(
    node(
      { ref: "e2", role: "main" },
      node(
        { ref: "e3", role: "form", name: "Sign up" },
        node({ ref: "e4", role: "textbox", name: "Name" }, name),
        node(
          { ref: "e5", role: "textbox", name: "Email" },
          ...(email === undefined ? [] : [email])
        ),
        node({
          ref: "e6",
          role: "checkbox",
          name: "Agree",
          state: agreed ? { checked: true } : {},
        }),
        node(
          { ref: "e7", role: "group", name: "Plan" },
          node({
            ref: "e8",
            role: "radio",
            name: "Free",
            state: { checked: true },
          }),
          ...(pro ? [node({ ref: "e9", role: "radio", name: "Pro" })] : [])
        ),
        node(
          { ref: "e10", role: "combobox", name: "Country" },
          node({
            ref: "e11",
            role: "option",
            name: "Hungary",
            state: { selected: true },
          }),
          node({ ref: "e12", role: "option", name: "Germany" })
        ),
        node({ ref: "e13", role: "slider", name: "Seats" }, "1"),
        node({ ref: "e14", role: "button", name: "Create account" })
      )
    )
  );
}

const controls = new Map<string, ControlState>([
  ["e13", { value: "1", range: { min: 1, max: 20, step: 1 } }],
]);

type Look = {
  projected: ProjectedStructuralNodeForest;
  controls?: Map<string, ControlState>;
};

function renderCard({ runs = [] }: { runs?: Run[] } = {}) {
  const onRun = vi.fn();
  const onPreview = vi.fn();
  let showPage: (look: Look) => void = () => {};
  let showRuns: (runs: Run[]) => void = () => {};

  function Harness() {
    const [look, setLook] = useState<Look>({
      projected: signUp(),
      controls,
    });
    const [shownRuns, setShownRuns] = useState(runs);
    showPage = setLook;
    showRuns = setShownRuns;
    const { roots } = buildStructureTree(
      look.projected,
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

/** A fill_form run that returned, filling the first `filled` of `fields`. */
function returnedRun(
  fields: { target: string; name: string; type: string; value: string }[],
  { filled = fields.length, error }: { filled?: number; error?: string } = {}
): Run {
  return {
    id: 1,
    toolName: "fill_form",
    arguments: { fields },
    status: "succeeded",
    result: JSON.stringify({
      filled: fields.slice(0, filled).map((field) => field.name),
      ...(error ? { failed: { name: fields[filled]!.name, error } } : {}),
    }),
    startedAt: 0,
    durationMs: 5,
    steps: [],
  };
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
      projected: signUp({ name: "Grace", email: "old@example.com" }),
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
      projected: signUp({ name: "Grace", agreed: false }),
      controls,
    });

    await expect.poll(() => form.changed()).toEqual([]);
    expect(await form.control("Name").inputValue()).toBe("Grace");
  });

  it("marks no row the run filled, even when the page shows it differently", async () => {
    const { form, showPage, showRuns } = renderCard();
    await form.set("Name", "  Grace ");
    showRuns([
      returnedRun([
        { target: "e4", name: "Name", type: "textbox", value: "  Grace " },
      ]),
    ]);
    showPage({
      projected: signUp({ name: "Grace" }),
      controls,
    });

    await expect.poll(() => form.changed()).toEqual([]);
    expect(await form.control("Name").inputValue()).toBe("Grace");
  });

  it("drops a radio choice whose radio left the page", async () => {
    const { card, form, onRun, showPage } = renderCard();
    await form.set("Plan", "Pro");
    await form.set("Name", "Grace");

    showPage({
      projected: signUp({ pro: false }),
      controls,
    });

    await expect.poll(() => form.changed()).toEqual(["Name"]);
    await card.runButton.click();
    expect(sentFields(onRun)).toEqual([
      { target: "e4", name: "Name", type: "textbox", value: "Grace" },
    ]);
  });

  it("marks the row of the field the run couldn't fill", async () => {
    const { form, showRuns } = renderCard();
    await form.set("Name", "Grace");
    await form.set("Country", "Germany");

    showRuns([
      returnedRun(
        [
          { target: "e4", name: "Name", type: "textbox", value: "Grace" },
          {
            target: "e10",
            name: "Country",
            type: "combobox",
            value: "Germany",
          },
        ],
        { filled: 1, error: "The select is disabled." }
      ),
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
  it("moves a row with the arrow keys on its handle", async () => {
    const { form } = renderCard();
    await form.set("Seats", "5");

    await form.moveButton("Seats").press("ArrowUp");
    await form.moveButton("Seats").press("ArrowUp");

    await expect
      .poll(() => form.names())
      .toEqual(["Name", "Email", "Agree", "Seats", "Plan", "Country"]);
  });

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
