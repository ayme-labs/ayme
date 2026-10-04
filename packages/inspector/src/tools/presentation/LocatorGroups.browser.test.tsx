import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { LocatorGroup } from "../domain/locatorGroups";
import type { RunnableTool } from "../domain/runnableTools";
import type { RefSource } from "../domain/refTree";
import { forest, node } from "../../structure/test-utils/projected";
import { buildStructureTree } from "../../structure";
import { aRun } from "../../runs/test-utils/runs";
import type { Run } from "../../runs";
import { renderPart } from "../../testing/renderPart";
import { RunCard as RunCardPart } from "../../testing";
import { RunCard } from "./RunCard";

// Component tests: generate_locator's form in a run card, built from a
// fixture page structure and driven through the run card's page object on
// playwright-lite. Each checks what the form shows and what it asks to run.

const page = createPage();
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  vi.restoreAllMocks();
});

const generateLocator: RunnableTool = {
  name: "generate_locator",
  action: "generate_locator",
  description: "Generate Playwright locators for elements.",
  available: true,
  locatorGroups: true,
  argumentsSchema: {
    type: "object",
    properties: { groups: { type: "array", items: { type: "object" } } },
    required: ["groups"],
  },
};

const orders = forest(
  node(
    { ref: "e2", role: "main" },
    node({ ref: "e7", role: "heading", name: "Orders" }),
    node(
      { ref: "e3", role: "list", name: "Orders" },
      node(
        { ref: "e5", role: "listitem", name: "Order 1" },
        node({ ref: "e4", role: "button", name: "Delete" })
      ),
      node(
        { ref: "e8", role: "listitem", name: "Order 2" },
        node({ ref: "e6", role: "button", name: "Delete" })
      )
    )
  )
);

function renderCard({ onPick }: { onPick?: RefSource["onPick"] } = {}) {
  const onRun = vi.fn();
  let showRuns: (runs: Run[]) => void = () => {};

  function Harness() {
    const [runs, setRuns] = useState<Run[]>([]);
    showRuns = setRuns;
    const { roots } = buildStructureTree(orders, new Map());
    return (
      <RunCard
        tool={generateLocator}
        available
        head={false}
        refSource={{
          roots,
          onPick,
          onPreview: () => {},
          onPreviewEnd: () => {},
        }}
        runs={runs}
        onRun={onRun}
        onShowRun={() => {}}
      />
    );
  }

  unmounts.push(renderPart(<Harness />));
  const card = new RunCardPart(
    page.getByRole("form", { name: "generate_locator", exact: true })
  );
  return {
    card,
    form: card.locatorGroups(),
    onRun,
    showRuns: (runs: Run[]) => showRuns(runs),
  };
}

/** The groups the last run asked for. */
function sentGroups(onRun: ReturnType<typeof vi.fn>) {
  return (onRun.mock.lastCall?.[0] as { groups: unknown[] }).groups;
}

/** A generate_locator run of `groups` that returned `result`'s groups. */
function returnedRun(groups: LocatorGroup[], result: unknown[]): Run {
  return aRun({
    toolName: "generate_locator",
    arguments: { groups },
    result: JSON.stringify({ groups: result }, null, 2),
  });
}

describe("choosing targets", () => {
  it("adds targets from the tree, in the order chosen, and runs with them", async () => {
    const { card, form, onRun } = renderCard();

    await form.toggleFromTree(1, "e7", "e4");
    expect(await form.targetRefs(1)).toEqual(["e7", "e4"]);

    await card.runButton.click();
    expect(sentGroups(onRun)).toEqual([{ targets: ["e7", "e4"] }]);
  });

  it("removes a target from the tree or by its button", async () => {
    const { form } = renderCard();

    await form.toggleFromTree(1, "e7", "e4", "e6", "e7");
    expect(await form.targetRefs(1)).toEqual(["e4", "e6"]);

    await form.removeTarget(1, "e4");
    expect(await form.targetRefs(1)).toEqual(["e6"]);
  });

  it("picks targets on the page one after another until Esc", async () => {
    const picks: Parameters<NonNullable<RefSource["onPick"]>>[0][] = [];
    const { form } = renderCard({
      onPick: (handlers) => {
        picks.push(handlers);
        return () => {};
      },
    });

    await form.pickButton(1).click();
    expect(await form.pickButton(1).getAttribute("aria-pressed")).toBe("true");
    picks.at(-1)!.onEnd("e4");
    await expect.poll(() => picks.length).toBe(2);
    picks.at(-1)!.onEnd("e6");
    await expect.poll(() => picks.length).toBe(3);
    picks.at(-1)!.onEnd(undefined);

    await expect.poll(() => form.targetRefs(1)).toEqual(["e4", "e6"]);
    await expect
      .poll(() => form.pickButton(1).getAttribute("aria-pressed"))
      .toBe("false");
  });
});

describe("containers", () => {
  it("sets a container per group, and a new group starts on the page", async () => {
    const { card, form, onRun } = renderCard();

    await form.toggleFromTree(1, "e7");
    await form.addGroupButton.click();
    await form.container(2).choose("e5");
    await form.toggleFromTree(2, "e4");
    await card.runButton.click();

    expect(sentGroups(onRun)).toEqual([
      { targets: ["e7"] },
      { targets: ["e4"], within: "e5" },
    ]);
  });

  it("goes back to the page, and drops a removed group", async () => {
    const { card, form, onRun } = renderCard();

    await form.container(1).choose("e5");
    await form.toggleFromTree(1, "e4");
    await form.usePage(1);
    await form.addGroupButton.click();
    await form.removeGroup(2);
    await card.runButton.click();

    expect(sentGroups(onRun)).toEqual([{ targets: ["e4"] }]);
  });
});

describe("the last run", () => {
  it("shows each target's locator or error, and copies a locator", async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    const { form, showRuns } = renderCard();
    await form.toggleFromTree(1, "e7", "e4");

    showRuns([
      returnedRun(
        [{ targets: ["e7", "e4"] }],
        [
          {
            locators: [
              {
                target: "e7",
                locator: "getByRole('heading', { name: 'Orders' })",
              },
              {
                target: "e4",
                error: 'Cannot generate a locator for "e4": it moved.',
              },
            ],
          },
        ]
      ),
    ]);

    await expect
      .poll(() => form.locator(1, "e7").textContent())
      .toBe("getByRole('heading', { name: 'Orders' })");
    expect(await form.target(1, "e4").textContent()).toContain(
      'Cannot generate a locator for "e4": it moved.'
    );
    await form.copyButton(1, "e7").click();
    expect(writeText).toHaveBeenCalledWith(
      "getByRole('heading', { name: 'Orders' })"
    );
  });

  it("shows a container's error on its group, and nothing once the container changes", async () => {
    const { form, showRuns } = renderCard();
    await form.container(1).choose("e5");
    await form.toggleFromTree(1, "e4");

    showRuns([
      returnedRun(
        [{ targets: ["e4"], within: "e5" }],
        [{ within: "e5", error: 'Cannot scope locators to ref "e5": removed.' }]
      ),
    ]);

    await expect
      .poll(() => form.groupError(1).textContent())
      .toBe('Cannot scope locators to ref "e5": removed.');
    await form.container(1).choose("e8");
    await expect.poll(() => form.groupError(1).count()).toBe(0);
  });
});
