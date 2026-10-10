import { afterEach, describe, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { refFilterOf } from "../infrastructure/refPicking";
import type { RunnableTool } from "../domain/runnableTools";
import { forest, node } from "../../structure/test-utils/projected";
import { buildStructureTree } from "../../structure";
import { renderPart } from "../../testing/renderPart";
import { RunCard as RunCardPart } from "../../testing";
import type { RefSource } from "../domain/refTree";
import { schemaText } from "../infrastructure/schemaText";
import { RunCard } from "./RunCard";

// Component tests: a run card's ref field, with a fixture tool and a
// hand-written page structure, driven through the run card's page object on
// playwright-lite. Picking on the page itself is ref picking's, so here
// `onPick` is a fixture; the e2e suite picks on a real page.

const page = createPage();
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

const click: RunnableTool = {
  name: "click",
  action: "click",
  description: "Click a real element ref from snapshot.",
  available: true,
  refField: "ref",
  argumentsSchema: {
    type: "object",
    properties: { ref: { type: "string" } },
    required: ["ref"],
  },
};

const { roots } = buildStructureTree(
  forest(
    node(
      { ref: "e1", role: "main" },
      node({
        ref: "e2",
        role: "heading",
        name: "Groceries",
        state: { level: 1 },
      }),
      node(
        { ref: "e3", label: "ListPage" },
        node({ ref: "e4", role: "textbox", name: "New item" }),
        node({
          ref: "e5",
          role: "button",
          name: "Add item",
          cursorPointer: true,
        })
      ),
      node(
        { ref: "e6", role: "list", name: "Items" },
        node({ ref: "e7", role: "listitem" }, "Milk"),
        node(
          { ref: "e8", role: "listitem" },
          node({ ref: "e9", role: "button", name: "Archive" })
        )
      )
    )
  ),
  new Map()
);

/** A fill-like tool: it can use text fields only. */
const textFieldsOnly = (node: { role: string }) => node.role === "textbox";

function renderCard(source: Partial<RefSource> | null = {}) {
  const onRun = vi.fn();
  unmounts.push(
    renderPart(
      <RunCard
        tool={click}
        available
        schemaText={schemaText}
        head={false}
        refSource={source ? { roots, ...source } : undefined}
        runs={[]}
        onRun={onRun}
        onShowRun={() => {}}
      />
    )
  );
  const card = new RunCardPart(
    page.getByRole("form", { name: click.action, exact: true })
  );
  return { card, ref: card.refField(), onRun };
}

/** The refs of the tree's rows that can be chosen. */
const enabledRefs = (rows: Element[]) =>
  rows
    .filter((row) => !(row as HTMLButtonElement).disabled)
    .map((row) => row.firstElementChild?.textContent);

async function nodeTexts(nodes: { allTextContents(): Promise<string[]> }) {
  return await nodes.allTextContents();
}

describe("choosing from the structure", () => {
  it("opens the page's structure as soon as the field is pressed", async () => {
    const { ref } = renderCard();

    await ref.chooser.click();

    expect(await nodeTexts(ref.nodes)).toEqual([
      "e1main",
      'e2heading"Groceries"',
      "e3generic",
      'e4textbox"New item"',
      'e5button"Add item"',
      'e6list"Items"',
      "e7listitemMilk",
      "e8listitem",
      'e9button"Archive"',
    ]);
  });

  it("runs the tool with the node chosen", async () => {
    const { card, ref, onRun } = renderCard();

    await ref.choose("e5");

    await expect
      .poll(() => ref.chooser.textContent())
      .toBe('e5 button "Add item"');
    expect(await ref.tree.count()).toBe(0);
    await card.runButton.click();
    expect(onRun).toHaveBeenCalledExactlyOnceWith({ ref: "e5" });
  });

  it("finds nodes by search, keeping each match's ancestors", async () => {
    const { ref } = renderCard();

    await ref.find("archive");

    await expect
      .poll(() => nodeTexts(ref.nodes))
      .toEqual(["e1main", 'e6list"Items"', "e8listitem", 'e9button"Archive"']);
  });

  it("offers no element before the page has been looked at", async () => {
    const { ref } = renderCard(null);

    await ref.open();

    expect(await ref.nodes.count()).toBe(0);
    expect(await ref.tree.textContent()).toBe("No element matches.");
  });

  it("says so when nothing matches", async () => {
    const { ref } = renderCard();

    await ref.find("checkout");

    await expect.poll(() => ref.nodes.count()).toBe(0);
    expect(await ref.tree.textContent()).toBe("No element matches.");
  });

  it("shows only the nodes the tool can use, under their disabled ancestors", async () => {
    const { ref } = renderCard({ canUse: textFieldsOnly });

    await ref.open();

    expect(await nodeTexts(ref.nodes)).toEqual([
      "e1main",
      "e3generic",
      'e4textbox"New item"',
    ]);
    expect(await ref.node("e1").isDisabled()).toBe(true);
    expect(await ref.node("e4").isEnabled()).toBe(true);
  });

  it("offers only what the runtime lists as the tool's targets", async () => {
    const targets = new Map([["click", ["e4", "e9"]]]);
    const { ref } = renderCard({
      canUse: refFilterOf(targets, "click"),
    });

    await ref.open();

    expect(await nodeTexts(ref.nodes)).toEqual([
      "e1main",
      "e3generic",
      'e4textbox"New item"',
      'e6list"Items"',
      "e8listitem",
      'e9button"Archive"',
    ]);
    expect(await ref.nodes.evaluateAll(enabledRefs)).toEqual(["e4", "e9"]);
  });

  it("chooses the first match the tool can use on Enter", async () => {
    const { ref } = renderCard({ canUse: textFieldsOnly });

    await ref.find("item");
    await ref.search.press("Enter");

    await expect
      .poll(() => ref.chooser.textContent())
      .toBe('e4 textbox "New item"');
  });

  it("closes on Esc, keeping the ref as it was", async () => {
    const { ref } = renderCard();
    await ref.choose("e5");

    await ref.find("archive");
    await ref.search.press("Escape");

    await expect.poll(() => ref.tree.count()).toBe(0);
    expect(await ref.chooser.textContent()).toBe('e5 button "Add item"');
  });
});

describe("picking on the page", () => {
  /** A fixture `onPick` that keeps what the field handed it. */
  function pickFixture() {
    const stop = vi.fn();
    const onPick = vi.fn<NonNullable<RefSource["onPick"]>>(() => stop);
    const handlers = () => onPick.mock.calls.at(-1)![0];
    return { onPick, stop, handlers };
  }

  it("takes the ref picked on the page", async () => {
    const pick = pickFixture();
    const { ref } = renderCard({ onPick: pick.onPick });

    await ref.pickOnPage();
    expect(await ref.isPicking()).toBe(true);
    pick.handlers().onEnd("e9");

    await expect
      .poll(() => ref.chooser.textContent())
      .toBe('e9 button "Archive"');
    expect(await ref.isPicking()).toBe(false);
  });

  it("says what to click for the tool", async () => {
    const pick = pickFixture();
    const { ref } = renderCard({
      onPick: pick.onPick,
      pickPrompt: "Click a text field to fill",
    });

    await ref.pickOnPage();

    expect(await ref.pickHint.textContent()).toBe(
      "Click a text field to fill. Esc cancels."
    );
  });

  it("keeps the ref when picking is cancelled", async () => {
    const pick = pickFixture();
    const { ref } = renderCard({ onPick: pick.onPick });
    await ref.choose("e5");

    await ref.pickOnPage();
    pick.handlers().onEnd(undefined);

    await expect.poll(() => ref.isPicking()).toBe(false);
    expect(await ref.chooser.textContent()).toBe('e5 button "Add item"');
  });

  it("picks only the nodes the tool can use", async () => {
    const pick = pickFixture();
    const { ref } = renderCard({
      onPick: pick.onPick,
      canUse: textFieldsOnly,
    });

    await ref.pickOnPage();

    expect(pick.handlers().accept("e4")).toBe(true);
    expect(pick.handlers().accept("e5")).toBe(false);
  });

  it("stops picking when the crosshair is pressed again", async () => {
    const pick = pickFixture();
    const { ref } = renderCard({ onPick: pick.onPick });

    await ref.pickOnPage();
    await ref.pickButton.click();

    expect(pick.stop).toHaveBeenCalledOnce();
    expect(await ref.isPicking()).toBe(false);
  });
});
