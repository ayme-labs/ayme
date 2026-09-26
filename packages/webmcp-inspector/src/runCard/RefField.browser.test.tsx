import { afterEach, describe, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { RunnableTool } from "../adapter/runnableTools";
import { buildStructureTree } from "../adapter/structure";
import { renderPart } from "../renderPart";
import { RunCard as RunCardPart } from "../testing";
import type { RefSource } from "./RefField";
import { RunCard } from "./RunCard";

// Component tests: a run card's ref field, with a fixture tool and a
// hand-written page structure, driven through the run card's page object on
// playwright-lite. Picking on the page itself is the adapter's, so here
// `onPick` is a fixture; the e2e suite picks on a real page.

const page = createPage();
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

const click: RunnableTool = {
  name: "click_page_state_ref",
  action: "click_page_state_ref",
  description: "Click a real element ref from get_page_context.",
  available: true,
  argumentsSchema: {
    type: "object",
    properties: { ref: { type: "string" } },
    required: ["ref"],
  },
};

const { roots } = buildStructureTree(
  `- e1 main:
  - e2 heading "Groceries" [level=1]
  - e3 ListPage:
    - e4 textbox "New item"
    - e5 button "Add item" [cursor=pointer]
  - e6 list "Items":
    - e7 listitem: Milk
    - e8 listitem:
      - e9 button "Archive"`,
  new Map()
);

/** A fill-like tool: it can use text fields only. */
const textFieldsOnly = (node: { role: string }) => node.role === "textbox";

function renderCard(source: Partial<RefSource> = {}) {
  const onRun = vi.fn();
  unmounts.push(
    renderPart(
      <RunCard
        tool={click}
        available
        head={false}
        refSource={{ roots, ...source }}
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

  it("says so when nothing matches", async () => {
    const { ref } = renderCard();

    await ref.find("checkout");

    await expect.poll(() => ref.nodes.count()).toBe(0);
    expect(await ref.tree.textContent()).toBe("No element matches.");
  });

  it("disables the nodes the tool can't use", async () => {
    const { ref } = renderCard({ canUse: textFieldsOnly });

    await ref.open();

    expect(await ref.node("e4").isEnabled()).toBe(true);
    expect(await ref.node("e5").isDisabled()).toBe(true);
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
