import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { anItem, aRun, aStep } from "../test-utils/runs";
import { RunsRegion } from "../../panel";
import { renderPart } from "../../testing/renderPart";
import { RunsView } from "../../testing";
import type { RunFocus } from "../domain/run";
import { Runs, type RunsProps } from "./Runs";

// Component tests: Runs with fixture runs, driven through its page object
// on playwright-lite. Each checks what Runs shows and which callback it
// calls, with which arguments.

const runsView = new RunsView(
  createPage().getByRole("region", { name: "Runs" })
);
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

const fillText = aStep({
  operation: "fill",
  locator: "getByRole('textbox', { name: 'New item' })",
  value: "Milk",
});
const clickAdd = aStep({
  locator: "getByRole('button', { name: 'Add item' })",
  member: "ListPage.addItemButton",
});

const addMilk = aRun({
  id: 1,
  arguments: { text: "Milk" },
  durationMs: 320,
  steps: [fillText, clickAdd],
});
const archiveGone = aRun({
  toolName: "ListPage.items.archive",
  className: "ListItem",
  item: anItem("ListPage.items[0]", { ref: "e3", label: "Milk" }),
  arguments: { ref: "e3", args: {} },
  status: "failed",
  error: 'Ref "e3" does not match a present instance.',
});

/**
 * Renders Runs in its region, keeping open and scope in state the way the
 * panel does. Returns its callbacks and a way to focus a run.
 */
function renderRuns(props: Partial<RunsProps> = {}) {
  const callbacks = {
    onAllRunsChange: vi.fn(),
    onOpenChange: vi.fn(),
    onClear: vi.fn(),
    onHover: vi.fn(),
  };
  let focusRun: (runId: number) => void = () => {};
  function Harness() {
    const [open, setOpen] = useState(true);
    const [allRuns, setAllRuns] = useState(false);
    const [focus, setFocus] = useState<RunFocus>();
    focusRun = (runId) => setFocus({ runId, at: Date.now() });
    return (
      <div className="flex h-[600px] flex-col">
        <RunsRegion collapsed={!open}>
          <Runs
            runs={[archiveGone, addMilk]}
            scopeLabel="This object"
            allRuns={allRuns}
            open={open}
            focus={focus}
            {...callbacks}
            onAllRunsChange={(all) => {
              callbacks.onAllRunsChange(all);
              setAllRuns(all);
            }}
            onOpenChange={(next) => {
              callbacks.onOpenChange(next);
              setOpen(next);
            }}
            {...props}
          />
        </RunsRegion>
      </div>
    );
  }
  unmounts.push(renderPart(<Harness />));
  return { ...callbacks, focusRun: (runId: number) => focusRun(runId) };
}

describe("Runs", () => {
  it("lists the runs made from the panel, newest first, marked as yours", async () => {
    renderRuns();

    await expect.poll(() => runsView.runs.count()).toBe(2);
    expect(await runsView.header.textContent()).toBe("Runs · 2");
    expect(await runsView.run(0).root.getAttribute("aria-label")).toBe(
      "ListPage.items.archive"
    );
    expect(await runsView.run(1).byYou.count()).toBe(1);
  });

  it("shows each run's steps, by member where it's known", async () => {
    renderRuns();
    const run = runsView.latest("ListPage.addItem");

    await expect.poll(() => run.status()).toBe("Succeeded");
    expect(await run.stepList()).toEqual([
      {
        operation: "fill",
        target: "getByRole('textbox', { name: 'New item' })",
        value: '"Milk"',
      },
      { operation: "click", target: "ListPage.addItemButton" },
    ]);
  });

  it("shows a failed run's error", async () => {
    renderRuns();
    const run = runsView.latest("ListPage.items.archive");

    await expect.poll(() => run.status()).toBe("Failed");
    expect(await run.error.textContent()).toBe(
      'Ref "e3" does not match a present instance.'
    );
  });

  it("highlights a step's element while it's hovered", async () => {
    const { onHover } = renderRuns();

    await runsView.latest("ListPage.addItem").stepTarget(1).hover();

    await expect
      .poll(() => onHover)
      .toHaveBeenCalledWith({ path: "ListPage.addItemButton" });
  });

  it("marks a step whose element was gone when the run ended", async () => {
    const { onHover } = renderRuns();
    const target = runsView.latest("ListPage.addItem").stepTarget(0);

    await target.hover();

    await expect
      .poll(() => target.getAttribute("title"))
      .toMatch(/^Not on the page when the run ended/);
    expect(onHover).not.toHaveBeenCalled();
  });

  it("switches from the selection's runs to all runs", async () => {
    const { onAllRunsChange } = renderRuns();

    expect(await runsView.selectionScope.textContent()).toBe("This object");
    await runsView.showAll();

    expect(onAllRunsChange).toHaveBeenCalledExactlyOnceWith(true);
    await expect
      .poll(() => runsView.allScope.getAttribute("aria-pressed"))
      .toBe("true");
  });

  it("collapses to its header", async () => {
    const { onOpenChange } = renderRuns();

    await runsView.header.click();

    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    await expect.poll(() => runsView.timeline.count()).toBe(0);
    expect(await runsView.scope.count()).toBe(0);
    expect((await runsView.root.boundingBox())?.height).toBe(38);
  });

  it("is cleared", async () => {
    const { onClear } = renderRuns();

    await runsView.clear();

    expect(onClear).toHaveBeenCalledOnce();
  });

  it("says when the selection has no runs", async () => {
    renderRuns({ runs: [] });

    await expect
      .poll(() => runsView.empty.textContent())
      .toBe("No runs for this selection yet. Switch to All to see every run.");
  });

  it("expands a run it's asked to show", async () => {
    const { focusRun } = renderRuns();
    const run = runsView.latest("ListPage.addItem");
    await run.toggle.click();
    await expect.poll(() => run.steps.count()).toBe(0);

    focusRun(1);

    await expect.poll(() => run.steps.count()).toBe(2);
  });
});

describe("a run's result", () => {
  beforeEach(() => {
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts collapsed, then shows as formatted JSON", async () => {
    const result = JSON.stringify({ added: "Milk", total: 2 }, null, 2);
    renderRuns({ runs: [aRun({ result })] });
    const run = runsView.run(0);

    await expect
      .poll(() => run.resultToggle.getAttribute("aria-expanded"))
      .toBe("false");
    expect(await run.result.count()).toBe(0);
    expect(await run.root.textContent()).not.toContain("total");

    await run.resultToggle.click();

    await expect.poll(() => run.result.textContent()).toBe(result);
  });

  it("copies the whole result, which scrolls rather than growing the run", async () => {
    const result = JSON.stringify(
      Array.from({ length: 200 }, (_, index) => ({ index })),
      null,
      2
    );
    renderRuns({ runs: [aRun({ result })] });
    const run = runsView.run(0);
    await run.resultToggle.click();

    const pre = run.result.locator("pre");
    expect(
      await pre.evaluate(
        (element) => element.scrollHeight > element.clientHeight
      )
    ).toBe(true);
    expect((await run.result.boundingBox())!.height).toBeLessThan(300);

    await run.copyResultButton.click();

    await expect
      .poll(() => navigator.clipboard.writeText)
      .toHaveBeenCalledExactlyOnceWith(result);
  });

  it("is copied while collapsed", async () => {
    renderRuns({ runs: [aRun({ result: '"Milk"' })] });

    await runsView.run(0).copyResultButton.click();

    await expect
      .poll(() => navigator.clipboard.writeText)
      .toHaveBeenCalledExactlyOnceWith('"Milk"');
  });

  it("isn't there when the tool returned undefined", async () => {
    renderRuns({ runs: [aRun({ durationMs: 320 })] });
    const run = runsView.run(0);

    await expect.poll(() => run.status()).toBe("Succeeded");
    expect(await run.resultToggle.count()).toBe(0);
    expect(await run.copyResultButton.count()).toBe(0);
    expect(await run.root.textContent()).toContain("320 ms");
    expect(await run.root.textContent()).not.toContain("Result");
  });

  it("is there for null, false, 0, the empty string and empty objects and arrays", async () => {
    const results = ["null", "false", "0", '""', "{}", "[]"];
    renderRuns({
      runs: results.map((result) => aRun({ result })),
    });

    await expect.poll(() => runsView.runs.count()).toBe(results.length);
    for (const [index, result] of results.entries()) {
      const run = runsView.run(index);
      expect(await run.resultText()).toBe(result);
      await run.copyResultButton.click();
      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(result);
    }
  });

  it("isn't there for a running or failed run, which keeps its error", async () => {
    renderRuns({
      runs: [aRun({ status: "running" }), archiveGone],
    });

    await expect.poll(() => runsView.run(0).status()).toBe("Running");
    expect(await runsView.run(0).resultToggle.count()).toBe(0);
    expect(await runsView.run(1).resultToggle.count()).toBe(0);
    expect(await runsView.run(1).error.textContent()).toBe(
      'Ref "e3" does not match a present instance.'
    );
  });

  it("shows when its run is asked to show, even from a collapsed run", async () => {
    const { focusRun } = renderRuns({
      runs: [aRun({ result: '"Eggs"' }), aRun({ id: 1, result: '"Milk"' })],
    });
    const run = runsView.run(1);
    await run.toggle.click();
    await expect.poll(() => run.resultToggle.count()).toBe(0);

    focusRun(1);

    await expect.poll(() => run.result.textContent()).toBe('"Milk"');
    expect(await runsView.run(0).result.count()).toBe(0);
  });
});

describe("a run's arguments", () => {
  it("aren't shown when there are none", async () => {
    renderRuns({ runs: [aRun({ arguments: {} })] });

    await expect.poll(() => runsView.run(0).status()).toBe("Succeeded");
    expect(await runsView.run(0).arguments.count()).toBe(0);
    expect(await runsView.run(0).root.textContent()).not.toContain("{}");
  });

  it("are shown with their null and falsy fields", async () => {
    const args = { text: "", copies: 0, urgent: false, note: null };
    renderRuns({ runs: [aRun({ arguments: args })] });

    await expect
      .poll(() => runsView.run(0).arguments.textContent())
      .toBe(JSON.stringify(args));
  });
});
