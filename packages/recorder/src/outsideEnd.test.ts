import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RecorderUpdate } from "./index";
import { startScriptedRecorder } from "./testing";

// An end from outside always finishes: from every state the recorder can be
// in, within a bounded time on its clock, whatever the browser never
// answers. It leaves a complete Recording Package or a clear "empty" (rule
// 9). The scripted browser plays a browser that hangs: it goes silent.

/** The wrap-up's time limit, and the trace's after it. */
const BOUND_MS = 5_000 + 60_000;

let projectDir: string;
beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ayme-recorder-end-"));
});
afterEach(() => rm(projectDir, { recursive: true }));

const idle = [`- generic [ref=e1]:`, `  - button "Save" [ref=e2]`].join("\n");
const click = {
  type: "click",
  selector: 'internal:role=button[name="Save"i]',
  target: { ref: "e2", tree: idle },
  values: { button: "left" },
};

const start = async () => {
  const scripted = await startScriptedRecorder({
    projectDir,
    url: "http://shop.test/",
  });
  scripted.browser.showPage(idle);
  const seen = { phase: "", entries: 0 };
  scripted.recorder.subscribe((update: RecorderUpdate) => {
    seen.phase = update.state.phase;
    seen.entries = update.state.visits.flatMap((visit) => visit.entries).length;
  });
  return { ...scripted, phase: () => seen.phase, entries: () => seen.entries };
};
type Started = Awaited<ReturnType<typeof start>>;

/** Record, and one click from held to written down: the recording is no
 * longer empty. */
async function recorded(
  { recorder, browser, entries }: Started,
  input = "input_1"
) {
  await recorder.send({ type: "record" });
  browser.holdClick();
  await browser.asks({ kind: "waitForSettled", page: "page_1", input });
  browser.settle();
  browser.report(click);
  await expect.poll(entries).toBe(1);
}

/** The package's text, when one was saved. */
const saved = async (outcome: { kind: string; folder?: string }) =>
  outcome.kind === "saved"
    ? readFile(join(outcome.folder!, "package.yaml"), "utf8")
    : null;

describe("an end from outside, with a browser that answers nothing any more", () => {
  it.each<{
    name: string;
    /** Brings the recorder to the state, and the browser to silence. */
    reach: (scripted: Started) => Promise<void>;
    ends: "empty" | "saved";
  }>([
    {
      name: "before anything is recorded",
      reach: async ({ browser }) => browser.goSilent(),
      ends: "empty",
    },
    {
      name: "while Record still waits for the trace to start",
      reach: async ({ recorder, browser }) => {
        browser.goSilent();
        void recorder.send({ type: "record" });
      },
      ends: "empty",
    },
    {
      name: "while Record still waits for the pages to hold inputs back",
      reach: async ({ recorder, browser }) => {
        browser.holdConfirmations();
        void recorder.send({ type: "record" });
        await browser.asks({ kind: "holdInputs", on: true });
        browser.goSilent();
      },
      ends: "empty",
    },
    {
      name: "while recording, with a click recorded",
      reach: async (scripted) => {
        await recorded(scripted);
        scripted.browser.goSilent();
      },
      ends: "saved",
    },
    {
      name: "while a click waits for its 'before'",
      reach: async (scripted) => {
        await recorded(scripted);
        scripted.browser.goSilent();
        scripted.browser.holdClick();
        await scripted.browser.asks({
          kind: "takeSnapshot",
          snapshot: "snapshot_3",
          page: "page_1",
        });
      },
      ends: "saved",
    },
    {
      name: "while a wrap-up after Stop waits for the pages",
      reach: async (scripted) => {
        await recorded(scripted);
        scripted.browser.goSilent();
        await scripted.recorder.send({ type: "stop" });
      },
      ends: "saved",
    },
    {
      name: "while a wrap-up after Stop waits for Playwright's recorder to switch off",
      reach: async (scripted) => {
        await recorded(scripted);
        void scripted.recorder.send({ type: "stop" });
        await scripted.browser.asks({
          kind: "takeSnapshot",
          snapshot: "snapshot_3",
          page: "page_1",
        });
        scripted.browser.goSilent();
      },
      ends: "saved",
    },
    {
      name: "while paused",
      reach: async (scripted) => {
        await recorded(scripted);
        await scripted.recorder.send({ type: "stop" });
        await expect.poll(scripted.phase).toBe("paused");
        scripted.browser.goSilent();
      },
      ends: "saved",
    },
    {
      name: "while Continue still waits for the pages",
      reach: async (scripted) => {
        await recorded(scripted);
        await scripted.recorder.send({ type: "stop" });
        await expect.poll(scripted.phase).toBe("paused");
        scripted.browser.goSilent();
        void scripted.recorder.send({ type: "continue" });
      },
      ends: "saved",
    },
    {
      name: "while a wrap-up after Clear waits for the pages",
      reach: async (scripted) => {
        await recorded(scripted);
        scripted.browser.goSilent();
        await scripted.recorder.send({ type: "clear" });
      },
      ends: "empty",
    },
    {
      name: "while a Clear waits for its trace to be gone",
      reach: async (scripted) => {
        await recorded(scripted);
        scripted.browser.holdTraceAnswers();
        await scripted.recorder.send({ type: "clear" });
        await scripted.browser.asks({ kind: "stopTrace", keep: false });
        scripted.browser.goSilent();
      },
      ends: "empty",
    },
    {
      name: "while a save waits for its trace to be stopped",
      reach: async (scripted) => {
        await recorded(scripted);
        scripted.browser.holdTraceAnswers();
        await scripted.recorder.send({ type: "finish" });
        await scripted.browser.asks({ kind: "stopTrace", keep: true });
        scripted.browser.goSilent();
      },
      ends: "saved",
    },
  ])(
    "finishes within a bounded time $name",
    { timeout: 15_000 },
    async ({ reach, ends }) => {
      const scripted = await start();
      await reach(scripted);

      const outcome = await scripted.endWithin(BOUND_MS);

      expect(outcome.kind).toBe(ends);
      // A package that is there is complete: the click recorded before the
      // browser went silent is in it.
      const text = await saved(outcome);
      if (ends === "saved") expect(text).toContain("id: interaction_1");
      else
        await expect(
          readdir(join(projectDir, ".ayme", "recordings"))
        ).rejects.toThrow(/ENOENT/);
      expect(scripted.browser.released).toBe(true);
    }
  );
});

describe("the time a trace's stop is given", () => {
  it("is a minute: then the package is written without its trace, and not before", async () => {
    const scripted = await start();
    const { recorder, browser } = scripted;
    await recorded(scripted);
    browser.holdTraceAnswers();
    await recorder.send({ type: "finish" });
    await browser.asks({ kind: "stopTrace", keep: true });

    await browser.advanceTime(59_999);
    // A command is answered after the time that passed before it.
    await expect(recorder.send({ type: "stop" })).resolves.toBe("ignored");
    expect(scripted.phase()).toBe("saving");
    await browser.advanceTime(1);

    const outcome = await recorder.done;
    expect(outcome.kind).toBe("saved");
    const text = await saved(outcome);
    expect(text).toContain("id: interaction_1");
    expect(text).toContain("tracePath: null");
    expect(await readdir((outcome as { folder: string }).folder)).toEqual([
      "package.yaml",
    ]);
  });

  it("is that stop's own: the time of one Clear's trace does not cut a later Clear's short", async () => {
    const scripted = await start();
    const { recorder, browser } = scripted;
    await recorded(scripted);
    // Clear at 0 s: its trace is gone at once.
    await recorder.send({ type: "clear" });
    await expect.poll(scripted.phase).toBe("notRecording");
    await recorded(scripted, "input_2");

    // Clear again at 59 s; this trace takes its time.
    await browser.advanceTime(59_000);
    browser.holdTraceAnswers();
    await recorder.send({ type: "clear" });
    await expect
      .poll(
        () =>
          browser.asked.filter(
            (request) => request.kind === "stopTrace" && !request.keep
          ).length
      )
      .toBe(2);
    // 61 s after the first Clear, 2 s after the second.
    await browser.advanceTime(2_000);
    await expect(recorder.send({ type: "record" })).resolves.toBe("ignored");
    expect(scripted.phase()).toBe("wrappingUp");

    browser.releaseTraceAnswers();
    await expect.poll(scripted.phase).toBe("notRecording");
    await scripted.endWithin(BOUND_MS);
  });
});
