import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { aChildRun, anInteraction, anItem, aRun } from "../test-utils/runs";
import { RunsRegion } from "../../panel";
import { renderPart } from "../../testing/renderPart";
import { RunsView } from "../../testing";
import type { Run, RunFocus } from "../domain/run";
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

const fillText = anInteraction({
  operation: "fill",
  locator: "getByRole('textbox', { name: 'New item' })",
  value: "Milk",
});
const clickAdd = anInteraction({
  locator: "getByRole('button', { name: 'Add item' })",
  member: "ListPage.addItemButton",
});

const addMilk = aRun({
  id: "1",
  arguments: { text: "Milk" },
  durationMs: 320,
  interactions: [fillText, clickAdd],
});
const archiveGone = aRun({
  toolName: "ListItem.archive",
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
function renderRuns(props: Partial<RunsProps> = {}, width?: number) {
  const callbacks = {
    onAllRunsChange: vi.fn(),
    onOpenChange: vi.fn(),
    onClear: vi.fn(),
    onHover: vi.fn(),
  };
  let focusRun: (runId: string) => void = () => {};
  let showRuns: (runs: readonly Run[]) => void = () => {};
  function Harness() {
    const [runs, setRuns] = useState(props.runs ?? [archiveGone, addMilk]);
    showRuns = setRuns;
    const [open, setOpen] = useState(true);
    const [allRuns, setAllRuns] = useState(false);
    const [focus, setFocus] = useState<RunFocus>();
    focusRun = (runId) => setFocus({ runId, at: Date.now() });
    return (
      <div className="flex h-[600px] flex-col" style={{ width }}>
        <RunsRegion collapsed={!open}>
          <Runs
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
            runs={runs}
          />
        </RunsRegion>
      </div>
    );
  }
  unmounts.push(renderPart(<Harness />));
  return {
    ...callbacks,
    focusRun: (runId: string) => focusRun(runId),
    showRuns: (runs: readonly Run[]) => showRuns(runs),
  };
}

/** Whether a row of the timeline fades in as it appears. */
function fadesIn(row: typeof runsView.runs) {
  return row.evaluate((item) =>
    getComputedStyle(item).transitionProperty.includes("opacity")
  );
}

describe("Runs", () => {
  it("keeps a run's tool name and time whole at Runs' narrowest width", async () => {
    renderRuns({ runs: [aRun({ toolName: "snapshot", durationMs: 25 })] }, 240);

    await expect.poll(() => runsView.runs.count()).toBe(1);
    const cut = await runsView.run(0).toggle.evaluate((toggle) => {
      const edge = toggle.getBoundingClientRect().right;
      return [...toggle.querySelectorAll("span")]
        .filter((span) => span.textContent)
        .filter(
          (span) =>
            span.scrollWidth > span.clientWidth ||
            span.getBoundingClientRect().right > edge
        )
        .map((span) => span.textContent);
    });
    expect(cut).toEqual([]);
  });

  it("lists the runs, newest first", async () => {
    renderRuns();

    await expect.poll(() => runsView.runs.count()).toBe(2);
    expect(await runsView.header.textContent()).toBe("Runs · 2");
    expect(await runsView.run(0).root.getAttribute("aria-label")).toBe(
      "ListItem.archive"
    );
  });

  it("marks each run with its Caller: an icon for Ayme's own, the name for any other", async () => {
    renderRuns({
      runs: [
        aRun({ by: "inspector" }),
        aRun({ by: "app" }),
        aRun({ by: "webmcp" }),
        aRun({ by: "ayme-mcp" }),
        aRun({ by: "support-assistant" }),
      ],
    });

    await expect.poll(() => runsView.runs.count()).toBe(5);
    const callers = [];
    for (let index = 0; index < 5; index++)
      callers.push(await runsView.run(index).caller());
    expect(callers).toEqual([
      { icon: "Run by you from the Inspector" },
      { icon: "Run by the app" },
      { icon: "Run by an agent through WebMCP" },
      { icon: "Run by an agent through Ayme MCP" },
      { text: "support-assistant" },
    ]);
  });

  it("follows a running run as it ends", async () => {
    const running = aRun({ id: "7", by: "webmcp", status: "running" });
    const { showRuns } = renderRuns({ runs: [running] });
    const run = runsView.run(0);
    await expect.poll(() => run.status()).toBe("Running");
    expect(await run.root.textContent()).toContain("Running…");

    showRuns([
      { ...running, status: "succeeded", durationMs: 42, result: "true" },
    ]);

    await expect.poll(() => run.status()).toBe("Succeeded");
    expect(await run.root.textContent()).toContain("42 ms");
    expect(await run.resultText()).toBe("true");
  });

  it("shows a run of a second or more in seconds", async () => {
    renderRuns({ runs: [aRun({ durationMs: 15204 })] });
    const run = runsView.run(0);

    await expect.poll(() => run.status()).toBe("Succeeded");
    expect(await run.card.textContent()).toContain("15.2 s · ");
    expect(await run.card.textContent()).not.toContain("15204");
  });

  it("shows only the time a run started when a reload cut it short", async () => {
    const reloaded = aRun({
      status: "failed",
      error: "The page reloaded before the run returned.",
      // Local time, as Runs shows it.
      startedAt: new Date(2026, 9, 23, 9, 5, 3).getTime(),
    });
    delete reloaded.durationMs;
    renderRuns({ runs: [reloaded] });
    const run = runsView.run(0);

    await expect.poll(() => run.status()).toBe("Failed");
    // Hours in two digits, with or without the locale's AM or PM.
    expect(await run.toggle.textContent()).toMatch(
      /^ListPage\.addItem09:05:03(\s[AP]M)?$/
    );
  });

  it("names a run's tool and its item in full on hover", async () => {
    renderRuns();
    const archive = runsView.latest("ListItem.archive");

    await expect
      .poll(() =>
        archive.card.getByTitle("ListItem.archive", { exact: true }).count()
      )
      .toBe(1);
    expect(
      await archive.card.getByTitle("items[0]", { exact: true }).count()
    ).toBe(1);
  });

  it("names an Interaction's member in full on hover, with its locator", async () => {
    renderRuns();
    const target = runsView.latest("ListPage.addItem").interactionTarget(1);

    await expect
      .poll(() => target.getAttribute("title"))
      .toBe(
        "ListPage.addItemButton: getByRole('button', { name: 'Add item' }). Hover to highlight it on the page."
      );
    expect(await target.textContent()).toBe("ListPage.addItemButton");
  });

  it("names an Interaction's target by its member's whole name", async () => {
    renderRuns();
    const run = runsView.latest("ListPage.addItem");

    await expect
      .poll(() =>
        run.interactions
          .getByRole("button", { name: "ListPage.addItemButton", exact: true })
          .count()
      )
      .toBe(1);
    expect(
      await run.interactions
        .getByRole("button", {
          name: "getByRole('textbox', { name: 'New item' })",
          exact: true,
        })
        .count()
    ).toBe(1);
  });

  it("marks the runs from before the page last loaded as earlier page rows", async () => {
    renderRuns({
      runs: [
        aRun({ by: "inspector" }),
        aRun({ by: "ayme-mcp", earlierDocument: true }),
      ],
    });

    await expect.poll(() => runsView.runs.count()).toBe(2);
    expect(await runsView.run(0).earlierPage.count()).toBe(0);
    expect(await runsView.run(1).earlierPage.count()).toBe(1);
    expect(await runsView.run(1).caller()).toEqual({
      icon: "Run by an agent through Ayme MCP",
    });
  });

  it("shows each run's Interactions, by member where it's known", async () => {
    renderRuns();
    const run = runsView.latest("ListPage.addItem");

    await expect.poll(() => run.status()).toBe("Succeeded");
    expect(await run.interactionList()).toEqual([
      {
        operation: "fill",
        target: "getByRole('textbox', { name: 'New item' })",
        value: '"Milk"',
      },
      { operation: "click", target: "ListPage.addItemButton" },
    ]);
  });

  it("nests the runs a run started under it, each with its own Interactions", async () => {
    renderRuns({
      runs: [
        aRun({
          toolName: "goal",
          by: "ayme-mcp",
          status: "running",
          children: [
            aChildRun({ interactions: [fillText, clickAdd] }),
            aChildRun({
              toolName: "ListItem.archive",
              status: "failed",
              error: "No such item.",
            }),
          ],
        }),
      ],
    });
    const goal = runsView.latest("goal");

    await expect.poll(() => runsView.runs.count()).toBe(1);
    expect(await runsView.header.textContent()).toBe("Runs · 1");
    expect(await goal.status()).toBe("Running");
    expect(await goal.interactions.count()).toBe(0);
    expect(await goal.childTools()).toEqual([
      "ListPage.addItem",
      "ListItem.archive",
    ]);
    const addItem = goal.child("ListPage.addItem");
    expect(await addItem.status()).toBe("Succeeded");
    // A child run names no Caller: its parent's started it.
    expect(await addItem.card.getByTitle(/^Run by /).count()).toBe(0);
    expect(await addItem.interactionList()).toEqual([
      {
        operation: "fill",
        target: "getByRole('textbox', { name: 'New item' })",
        value: '"Milk"',
      },
      { operation: "click", target: "ListPage.addItemButton" },
    ]);
    const archive = goal.child("ListItem.archive");
    expect(await archive.status()).toBe("Failed");
    expect(await archive.error.textContent()).toBe("No such item.");
    expect(await archive.interactions.count()).toBe(0);
  });

  it("hides the runs a run started while it's collapsed", async () => {
    renderRuns({
      runs: [aRun({ toolName: "goal", children: [aChildRun()] })],
    });
    const goal = runsView.latest("goal");
    await expect.poll(() => goal.childRuns.count()).toBe(1);

    await goal.toggle.click();

    await expect.poll(() => goal.childRuns.count()).toBe(0);
  });

  it("shows a failed run's error", async () => {
    renderRuns();
    const run = runsView.latest("ListItem.archive");

    await expect.poll(() => run.status()).toBe("Failed");
    expect(await run.error.textContent()).toBe(
      'Ref "e3" does not match a present instance.'
    );
  });

  it("highlights an Interaction's element while it's hovered", async () => {
    const { onHover } = renderRuns();

    await runsView.latest("ListPage.addItem").interactionTarget(1).hover();

    await expect
      .poll(() => onHover)
      .toHaveBeenCalledWith({ path: "ListPage.addItemButton" });
  });

  it("marks an Interaction whose element was gone when the run ended", async () => {
    const { onHover } = renderRuns();
    const target = runsView.latest("ListPage.addItem").interactionTarget(0);

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

  it("says no run has happened yet, with nothing selected to narrow to", async () => {
    renderRuns({ runs: [], scopeLabel: "This page" });

    await expect
      .poll(() => runsView.empty.textContent())
      .toBe("No runs yet. Runs from this panel and from agents show here.");
  });

  it("fades in a run that starts while it shows, not the runs it opened with", async () => {
    const opened = aRun({
      id: "1",
      toolName: "goal",
      children: [aChildRun()],
    });
    const { showRuns } = renderRuns({ runs: [opened] });
    await expect.poll(() => runsView.runs.count()).toBe(1);

    showRuns([aRun({ id: "2", startedAt: Date.now() + 60_000 }), opened]);

    await expect.poll(() => runsView.runs.count()).toBe(2);
    expect(await fadesIn(runsView.run(0).root)).toBe(true);
    expect(await fadesIn(runsView.run(1).root)).toBe(false);
    expect(await fadesIn(runsView.run(1).childRuns.first())).toBe(false);
  });

  it("doesn't fade in a run that started the moment it opened", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const { showRuns } = renderRuns({ runs: [] });
    vi.useRealTimers();

    showRuns([aRun({ startedAt: 1_000_000 })]);

    await expect.poll(() => runsView.runs.count()).toBe(1);
    expect(await fadesIn(runsView.run(0).root)).toBe(false);
  });

  it("doesn't fade in a run that started while it was closed", async () => {
    const { showRuns } = renderRuns({ runs: [addMilk] });
    await runsView.header.click();
    await expect.poll(() => runsView.timeline.count()).toBe(0);
    showRuns([aRun({ id: "2", startedAt: Date.now() }), addMilk]);

    await runsView.header.click();

    await expect.poll(() => runsView.runs.count()).toBe(2);
    expect(await fadesIn(runsView.run(0).root)).toBe(false);
  });

  it("expands a run it's asked to show", async () => {
    const { focusRun } = renderRuns();
    const run = runsView.latest("ListPage.addItem");
    await run.toggle.click();
    await expect.poll(() => run.interactions.count()).toBe(0);

    focusRun("1");

    await expect.poll(() => run.interactions.count()).toBe(2);
  });

  it("flashes a run it's asked to show, for a moment each time", async () => {
    const { focusRun } = renderRuns();
    const run = runsView.latest("ListPage.addItem");

    focusRun("1");
    await expect.poll(() => run.flashing()).toBe(true);
    await expect.poll(() => run.flashing(), { timeout: 4000 }).toBe(false);
    focusRun("1");

    await expect.poll(() => run.flashing()).toBe(true);
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

  it("shows a multi-line string as its lines, but copies the JSON", async () => {
    const result = JSON.stringify({ structure: "- e5:\n  - main" }, null, 2);
    renderRuns({ runs: [aRun({ result })] });
    const run = runsView.run(0);
    await run.resultToggle.click();

    await expect
      .poll(() => run.result.textContent())
      .toBe('{\n  "structure":\n    - e5:\n      - main\n}');

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

  it("says it copied, for a moment", async () => {
    renderRuns({ runs: [aRun({ result: '"Milk"' })] });
    const run = runsView.run(0);
    const copied = run.card.getByRole("button", {
      name: "Copied",
      exact: true,
    });

    await run.copyResultButton.click();

    await expect.poll(() => copied.count()).toBe(1);
    await expect.poll(() => copied.count(), { timeout: 3000 }).toBe(0);
    expect(await run.copyResultButton.count()).toBe(1);
  });

  it("tells assistive technology it copied", async () => {
    renderRuns({ runs: [aRun({ result: '"Milk"' })] });
    const run = runsView.run(0);
    expect(await run.card.getByRole("status").textContent()).toBe("");

    await run.copyResultButton.click();

    await expect
      .poll(() => run.card.getByRole("status").textContent())
      .toBe("Copied");
  });

  it("says it copied only on the run it copied, when another has the same result", async () => {
    renderRuns({
      runs: [
        aRun({ id: "2", result: '"Milk"' }),
        aRun({ id: "1", result: '"Milk"' }),
      ],
    });

    await runsView.run(0).copyResultButton.click();

    await expect
      .poll(() => runsView.run(0).card.getByRole("status").textContent())
      .toBe("Copied");
    expect(await runsView.run(1).card.getByRole("status").textContent()).toBe(
      ""
    );
    expect(await runsView.run(1).copyResultButton.count()).toBe(1);
  });

  it("stays put on a page that offers no clipboard", async () => {
    // A page served over plain http from another machine has none.
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    const errors: unknown[] = [];
    const recordError = (event: ErrorEvent) => errors.push(event.error);
    window.addEventListener("error", recordError);
    try {
      renderRuns({ runs: [aRun({ result: '"Milk"' })] });
      const run = runsView.run(0);

      await run.copyResultButton.click();

      expect(errors).toEqual([]);
      expect(await run.copyResultButton.count()).toBe(1);
    } finally {
      window.removeEventListener("error", recordError);
      Reflect.deleteProperty(navigator, "clipboard");
    }
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
      runs: [aRun({ result: '"Eggs"' }), aRun({ id: "1", result: '"Milk"' })],
    });
    const run = runsView.run(1);
    await run.toggle.click();
    await expect.poll(() => run.resultToggle.count()).toBe(0);

    focusRun("1");

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
