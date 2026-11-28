import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StructuralTree } from "@ayme-dev/core/structural-observation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecorderUpdate } from "./index";
import { Timeline, type TimelineAddition } from "./timeline/domain";
import { startScriptedRecorder, type ScriptedBrowser } from "../testing";
import { entryId } from "../testing/ids";

// A recorder whose own work breaks, on the scripted browser: it goes on
// recording, says what was lost, and leaves nobody waiting. The timeline is
// made to break here, on its one way in, since every real cause of a break
// is a bug that is fixed where it is found.

let projectDir: string;
beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ayme-recorder-keeps-going-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(projectDir, { recursive: true });
});

const idle = [`- generic [ref=e1]:`, `  - button "Save" [ref=e2]`].join("\n");
const saved = `${idle}\n  - status [ref=e3]: Saved`;
const click = {
  type: "click",
  selector: 'internal:role=button[name="Save"i]',
  target: { ref: "e2", tree: idle },
  values: { button: "left" },
};

const settledAfter = (input: string) =>
  ({ kind: "waitForSettled", page: "page_1", input }) as const;

async function start() {
  const scripted = await startScriptedRecorder({
    projectDir,
    url: "http://shop.test/",
  });
  scripted.browser.showPage(idle);
  const updates: RecorderUpdate[] = [];
  scripted.recorder.subscribe((update) => updates.push(update));
  return { ...scripted, latest: () => updates.at(-1)!.state };
}

/** One reported click, from held to its "after", with the page as `after`
 * shows it once the click has reached it. */
async function recordClick(
  browser: ScriptedBrowser,
  input: string,
  after: string
) {
  browser.holdClick();
  await browser.asks(settledAfter(input));
  browser.showPage(after);
  browser.settle();
  browser.report(click);
}

/** The timeline breaks on the first addition of this kind, and takes every
 * other as ever. */
function breakTheTimelineOn(kind: TimelineAddition["kind"], reason: string) {
  const add = Timeline.prototype.add;
  let broke = false;
  vi.spyOn(Timeline.prototype, "add").mockImplementation(function (
    this: Timeline,
    addition
  ) {
    if (broke || addition.kind !== kind) return add.call(this, addition);
    broke = true;
    return Promise.reject(new Error(reason));
  });
}

describe("a recorder whose timeline breaks", () => {
  it("goes on recording, warns that the step is missing, and saves the steps after it", async () => {
    const { recorder, browser, latest } = await start();
    await recorder.send({ type: "record" });
    breakTheTimelineOn("interaction", "Maximum call stack size exceeded");

    await recordClick(browser, "input_1", saved);

    await expect
      .poll(() => latest().warnings)
      .toEqual([
        {
          kind: "notRecorded",
          message:
            'A step is missing from the recording: click on internal:role=button[name="Save"i]. The trace still holds it. The recorder\'s error: Maximum call stack size exceeded',
        },
      ]);
    expect(latest().phase).toBe("recording");

    await recordClick(browser, "input_2", idle);
    await expect.poll(() => latest().visits[0]?.entries).toHaveLength(1);
    await recorder.send({ type: "finish" });

    const outcome = await recorder.done;
    expect(outcome).toMatchObject({ kind: "saved" });
    const folder = (outcome as { folder: string }).folder;
    await expect(
      readFile(join(folder, "package.yaml"), "utf8")
    ).resolves.toContain("id: interaction_1");
  });

  it("still records the steps after one it broke half-way through writing, and saves the package with that step's place in the trace", async () => {
    const { recorder, browser, latest } = await start();
    await recorder.send({ type: "record" });
    // The timeline's own comparison of two reads, which passes `sameIdentity`,
    // breaks once: by then it has taken the step off its waiting list.
    const reconcile = StructuralTree.reconcile.bind(StructuralTree);
    let broke = false;
    vi.spyOn(StructuralTree, "reconcile").mockImplementation(
      (before, after, options) => {
        if (broke || !options?.sameIdentity)
          return reconcile(before, after, options);
        broke = true;
        throw new Error("It broke.");
      }
    );

    await recordClick(browser, "input_1", saved);
    await expect.poll(() => broke).toBe(true);
    await recordClick(browser, "input_2", idle);
    await expect
      .poll(() => latest().visits[0]?.entries.map(({ id }) => id))
      .toContain("interaction_2");
    await recorder.send({ type: "finish" });

    const outcome = await recorder.done;
    expect(outcome).toMatchObject({ kind: "saved" });
    const text = await readFile(
      join((outcome as { folder: string }).folder, "package.yaml"),
      "utf8"
    );
    expect(text).toContain("id: interaction_2");
    expect(text).toContain("interactionId: interaction_1");
  });

  it("names a step that has no selector by Playwright's name for it alone", async () => {
    const { recorder, browser, latest } = await start();
    await recorder.send({ type: "record" });
    breakTheTimelineOn("interaction", "It broke.");

    browser.holdClick();
    await browser.asks(settledAfter("input_1"));
    browser.settle();
    browser.report({ ...click, selector: null });

    await expect
      .poll(() => latest().warnings)
      .toEqual([
        {
          kind: "notRecorded",
          message:
            "A step is missing from the recording: click. The trace still holds it. The recorder's error: It broke.",
        },
      ]);
    recorder.end();
    await recorder.done;
  });

  it("passes a held click on to the page when the read before it could not be kept, and says what could not", async () => {
    const { recorder, browser, latest, endWithin } = await start();
    await recorder.send({ type: "record" });
    breakTheTimelineOn("snapshot", "It broke.");

    browser.holdClick();

    await expect.poll(() => browser.passedOn).toEqual(["input_1"]);
    expect(latest().warnings).toEqual([
      {
        kind: "notRecorded",
        message:
          "Something may be missing from the recording: the recorder could not add to its timeline (snapshot). The trace still holds what happened. The recorder's error: It broke.",
      },
    ]);
    expect(latest().phase).toBe("recording");
    // The click still waits for its Settled Page: the end waits that out on
    // the recorder's clock.
    await endWithin(65_000);
  });

  it("answers the command that led to the break", async () => {
    const { recorder, browser, latest } = await start();
    await recorder.send({ type: "record" });
    await recordClick(browser, "input_1", saved);
    await expect.poll(() => latest().visits[0]?.entries).toHaveLength(1);
    breakTheTimelineOn("discard", "It broke.");

    await expect(
      recorder.send({ type: "discard", entry: entryId("interaction_1") })
    ).resolves.toBe("applied");

    expect(latest().warnings).toHaveLength(1);
    expect(latest().phase).toBe("recording");
    recorder.end();
    await recorder.done;
  });

  // Highlight.
  it("answers a highlight 'notFound' when it breaks looking for the element, and highlights the next one", async () => {
    const { recorder, browser, latest } = await start();
    await recorder.send({ type: "record" });
    await recordClick(browser, "input_1", saved);
    await expect.poll(() => latest().visits[0]?.entries).toHaveLength(1);
    vi.spyOn(Timeline.prototype, "liveTarget").mockImplementationOnce(() => {
      throw new Error("It broke.");
    });
    const highlight = {
      type: "highlight",
      entry: entryId("interaction_1"),
    } as const;

    await expect(recorder.send(highlight)).resolves.toBe("notFound");
    expect(browser.highlighted).toBeNull();

    await expect(recorder.send(highlight)).resolves.toBe("applied");
    expect(browser.highlighted).not.toBeNull();
    recorder.end();
    await recorder.done;
  });
});

describe("a recorder that breaks at anything else it carries out", () => {
  it("says that a part of its work was not done, and goes on", async () => {
    const { recorder, browser, latest } = await start();
    const warning = {
      kind: "playwrightUnverified",
      message: "Playwright 1.99.0 is newer than the recorder is verified on.",
    } as const;
    // Telling a warning reads the timeline's Visits: that read breaks once.
    vi.spyOn(Timeline.prototype, "visits").mockImplementationOnce(() => {
      throw new Error("It broke.");
    });

    browser.warn(warning);

    await expect
      .poll(() => latest().warnings)
      .toEqual([
        warning,
        {
          kind: "notRecorded",
          message:
            "Something may be missing from the recording: the recorder could not do a part of its own work. The recorder's error: It broke.",
        },
      ]);
    await expect(recorder.send({ type: "record" })).resolves.toBe("applied");
    recorder.end();
    await recorder.done;
  });
});

describe("a recorder with a subscriber that breaks", () => {
  it("tells its other subscribers all the same, and goes on", async () => {
    const { recorder } = await startScriptedRecorder({ projectDir });
    let told = 0;
    recorder.subscribe(() => {
      // The first call is the subscriber's own: it is told the state as it
      // subscribes.
      if (++told > 1) throw new Error("It broke.");
    });
    const phases: string[] = [];
    recorder.subscribe(({ state }) => phases.push(state.phase));

    await expect(recorder.send({ type: "record" })).resolves.toBe("applied");

    expect(told).toBeGreaterThan(1);
    expect(phases.at(-1)).toBe("recording");
    recorder.end();
    await expect(recorder.done).resolves.toEqual({ kind: "empty" });
  });
});

describe("a recorder whose browser breaks as it takes a request", () => {
  it("goes on as when the browser could not carry the request out: a click whose page cannot be read reaches the page", async () => {
    const { recorder, browser, latest, endWithin } = await start();
    await recorder.send({ type: "record" });
    browser.breakOn("takeSnapshot", "The page is gone.");

    browser.holdClick();

    await expect.poll(() => browser.passedOn).toEqual(["input_1"]);
    expect(latest().phase).toBe("recording");
    await endWithin(65_000);
  });
});

describe("a recorder whose adapter cannot read a click's report", () => {
  it("records that click without its element, and the next click with its own element and changes, and Finish waits for no time limit", async () => {
    const { recorder, browser } = await start();
    await recorder.send({ type: "record" });
    const sent = `${saved}\n  - status [ref=e4]: Sent`;

    // Click A: its report as the adapter tells one it could not read, with
    // what Playwright gave and no element.
    browser.holdClick();
    await browser.asks(settledAfter("input_1"));
    browser.showPage(saved);
    browser.settle();
    browser.report({
      type: "click",
      selector: null,
      target: null,
      values: { button: "left", clickCount: 1, modifiers: 0 },
    });
    // Click B, of the same button, read in full.
    browser.holdClick();
    await browser.asks(settledAfter("input_2"));
    browser.showPage(sent);
    browser.settle();
    browser.report({ ...click, target: { ref: "e2", tree: saved } });

    await recorder.send({ type: "finish" });
    // The scripted clock stands still: an end that waited for a time limit
    // would never come.
    const outcome = await recorder.done;
    expect(outcome).toMatchObject({ kind: "saved" });
    const text = await readFile(
      join((outcome as { folder: string }).folder, "package.yaml"),
      "utf8"
    );
    const [, a = "", b = ""] = text
      .split("traceActionPoints:")[0]!
      .split(/\n(?= {6}- kind: interaction)/);
    expect(a).toContain("type: click");
    expect(a).toContain("targetRef: null");
    expect(a).not.toContain("targetSelector");
    expect(a).toContain("Saved");
    expect(a).not.toContain("Sent");
    expect(b).toContain("targetRef: e2");
    expect(b).toContain("Sent");
  });
});
