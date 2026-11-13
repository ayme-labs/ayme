import { describe, expect, it } from "vitest";

import type { RecorderUpdate } from "./index";
import { startScriptedRecorder } from "./testing";

describe("a recorder", () => {
  it("ends with 'empty' when it is ended from outside before anything was recorded", async () => {
    const { recorder } = await startScriptedRecorder();

    recorder.end();

    await expect(recorder.done).resolves.toEqual({ kind: "empty" });
  });

  it("can be ended again, before and after it has ended", async () => {
    const { recorder } = await startScriptedRecorder();

    recorder.end();
    recorder.end();
    const outcome = await recorder.done;
    recorder.end();

    expect(outcome).toEqual({ kind: "empty" });
    await expect(recorder.done).resolves.toBe(outcome);
  });

  it("ends with 'empty' when the last page is closed", async () => {
    const { recorder, browser } = await startScriptedRecorder();

    browser.closePage({ pagesLeft: 0 });

    await expect(recorder.done).resolves.toEqual({ kind: "empty" });
  });

  it("keeps going when a page is closed while another is open", async () => {
    const { recorder, browser } = await startScriptedRecorder();
    const updates: RecorderUpdate[] = [];
    recorder.subscribe((update) => updates.push(update));

    browser.closePage({ pagesLeft: 1 });

    // With the page it knew closed, Record no longer applies; it has not
    // ended.
    await expect
      .poll(() => updates.at(-1))
      .toEqual({
        revision: 2,
        state: { phase: "notRecording", visits: [], commands: [] },
      });
    expect(updates).toHaveLength(2);
  });

  it("tells a subscriber what a wrap-up leads to, also when an outside end changes it", async () => {
    const { recorder, browser } = await startScriptedRecorder();
    await recorder.send({ type: "record" });
    const updates: RecorderUpdate[] = [];
    recorder.subscribe((update) => updates.push(update));
    browser.holdConfirmations();

    await recorder.send({ type: "stop" });
    recorder.end();
    // A command is answered after everything that happened before it.
    await recorder.send({ type: "stop" });

    expect(updates.map(({ state }) => state)).toEqual([
      expect.objectContaining({
        phase: "recording",
        commands: ["finish", "stop", "clear"],
      }),
      expect.objectContaining({
        phase: "wrappingUp",
        then: "pause",
        commands: [],
      }),
      expect.objectContaining({ phase: "wrappingUp", then: "save" }),
    ]);
    browser.releaseConfirmations();
    await recorder.done;
  });

  it("has let the browser go by the time it reports the end", async () => {
    const { recorder, browser } = await startScriptedRecorder();
    expect(browser.released).toBe(false);

    recorder.end();
    await recorder.done;

    expect(browser.released).toBe(true);
  });

  it("tells a subscriber the full state at once, then each change with a higher revision", async () => {
    const { recorder } = await startScriptedRecorder();
    const updates: RecorderUpdate[] = [];

    recorder.subscribe((update) => updates.push(update));
    expect(updates).toEqual([
      {
        revision: 1,
        state: { phase: "notRecording", visits: [], commands: ["record"] },
      },
    ]);

    recorder.end();
    await recorder.done;
    expect(updates).toEqual([
      {
        revision: 1,
        state: { phase: "notRecording", visits: [], commands: ["record"] },
      },
      {
        revision: 2,
        state: {
          phase: "ended",
          outcome: { kind: "empty" },
          visits: [],
          commands: [],
        },
      },
    ]);
  });

  it("tells a late subscriber the state as it is now", async () => {
    const { recorder } = await startScriptedRecorder();
    recorder.end();
    await recorder.done;
    const updates: RecorderUpdate[] = [];

    recorder.subscribe((update) => updates.push(update));

    expect(updates).toEqual([
      {
        revision: 2,
        state: {
          phase: "ended",
          outcome: { kind: "empty" },
          visits: [],
          commands: [],
        },
      },
    ]);
  });

  it("stops telling a subscriber that unsubscribed", async () => {
    const { recorder } = await startScriptedRecorder();
    const updates: RecorderUpdate[] = [];
    const unsubscribe = recorder.subscribe((update) => updates.push(update));

    unsubscribe();
    recorder.end();
    await recorder.done;

    expect(updates).toHaveLength(1);
  });

  it("answers a command that does not apply now with 'ignored', also after its end", async () => {
    const { recorder } = await startScriptedRecorder();

    await expect(recorder.send({ type: "finish" })).resolves.toBe("ignored");

    recorder.end();
    await recorder.done;
    await expect(recorder.send({ type: "finish" })).resolves.toBe("ignored");
  });

  it("serves no window yet", async () => {
    const { recorder } = await startScriptedRecorder();

    expect(recorder.windowUrl).toBeNull();
    recorder.end();
    await recorder.done;
  });
});
