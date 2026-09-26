import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import type { RunStep } from "../adapter/runSteps";
import type { Run } from "../adapter/useRuns";
import { RunsRegion } from "../frame/InspectorBody";
import { renderPart } from "../renderPart";
import { RunsView } from "../testing";
import { Runs, type RunFocus, type RunsProps } from "./Runs";

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

const fillText: RunStep = {
  operation: "fill",
  locator: "getByRole('textbox', { name: 'New item' })",
  value: "Milk",
};
const clickAdd: RunStep = {
  operation: "click",
  locator: "getByRole('button', { name: 'Add item' })",
  member: "ListPage.addItemButton",
};

const addMilk: Run = {
  id: 1,
  toolName: "ListPage.addItem",
  className: "ListPage",
  objectPath: "ListPage",
  arguments: { text: "Milk" },
  status: "succeeded",
  startedAt: 0,
  durationMs: 320,
  steps: [fillText, clickAdd],
};
const archiveGone: Run = {
  id: 2,
  toolName: "ListPage.items.archive",
  className: "ListItem",
  objectPath: "ListPage.items[0]",
  item: { path: "ListPage.items[0]", ref: "e3", label: "Milk" },
  arguments: { ref: "e3", args: {} },
  status: "failed",
  error: 'Ref "e3" does not match a present instance.',
  startedAt: 0,
  durationMs: 12,
  steps: [],
};

/**
 * Renders Runs in its region, keeping open and scope in state the way the
 * panel does. Returns its callbacks and a way to focus a run.
 */
function renderRuns(props: Partial<RunsProps> = {}) {
  const callbacks = {
    onAllRunsChange: vi.fn(),
    onOpenChange: vi.fn(),
    onClear: vi.fn(),
    onPreviewStep: vi.fn(async () => true),
    onPreviewStepEnd: vi.fn(),
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
    const { onPreviewStep } = renderRuns();

    await runsView.latest("ListPage.addItem").stepTarget(1).hover();

    await expect.poll(() => onPreviewStep).toHaveBeenCalledWith(clickAdd);
  });

  it("marks a step whose element is no longer on the page", async () => {
    renderRuns({ onPreviewStep: vi.fn(async () => false) });
    const target = runsView.latest("ListPage.addItem").stepTarget(0);

    await target.hover();

    await expect
      .poll(() => target.getAttribute("title"))
      .toMatch(/^Not on the page now/);
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
