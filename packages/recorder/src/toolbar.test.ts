import { afterEach, describe, expect, it } from "vitest";

import type { RecorderUpdate } from "./index";
import { startScriptedRecorder } from "./testing";

// The in-page toolbar's way to the recorder: the one function a recorded
// page calls with a message, which the stock adapter exposes to every page.
// Here the test is the page.

const ends: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const end of ends.splice(0)) await end();
});

async function start() {
  const started = await startScriptedRecorder();
  ends.push(() => {
    started.recorder.end();
    return started.recorder.done;
  });
  return started;
}

describe("the toolbar's way to the recorder", () => {
  it("gives the toolbar the state as it is now, at once", async () => {
    const { toolbar } = await start();

    const update = (await toolbar({
      kind: "update",
      after: -1,
    })) as RecorderUpdate;

    expect(update.state).toEqual({
      phase: "notRecording",
      visits: [],
      commands: ["record"],
      warnings: [],
    });
  });

  it("answers the toolbar's command as the recorder does, and tells it the change that follows", async () => {
    const { toolbar } = await start();
    const first = (await toolbar({
      kind: "update",
      after: -1,
    })) as RecorderUpdate;
    const next = toolbar({ kind: "update", after: first.revision });

    await expect(
      toolbar({ kind: "send", command: { type: "record" } })
    ).resolves.toBe("applied");

    const changed = (await next) as RecorderUpdate;
    expect(changed.revision).toBeGreaterThan(first.revision);
    expect(changed.state.phase).toBe("recording");
    await expect(
      toolbar({ kind: "send", command: { type: "record" } })
    ).resolves.toBe("ignored");
  });

  it("takes Assert visibility from the toolbar, and shows the window's change as the window shows the toolbar's", async () => {
    const { toolbar, recorder } = await start();
    await recorder.send({ type: "record" });

    await expect(
      toolbar({ kind: "send", command: { type: "assertVisibility" } })
    ).resolves.toBe("applied");
    // Shown once Playwright is in its picking mode.
    await expect
      .poll(
        async () =>
          ((await toolbar({ kind: "update", after: -1 })) as RecorderUpdate)
            .state
      )
      .toMatchObject({ phase: "recording", picking: true });
    const picking = (await toolbar({
      kind: "update",
      after: -1,
    })) as RecorderUpdate;

    await recorder.send({ type: "leaveAssertVisibility" });
    const left = (await toolbar({
      kind: "update",
      after: picking.revision,
    })) as RecorderUpdate;
    expect(left.state).not.toHaveProperty("picking");
  });

  it("ignores a message that is none of the toolbar's", async () => {
    const { toolbar, recorder } = await start();

    await expect(
      toolbar({ kind: "send", command: { type: "explode" } })
    ).resolves.toBe("ignored");
    await expect(toolbar("finish")).resolves.toBe("ignored");
    let phase = "";
    recorder.subscribe(({ state }) => (phase = state.phase));
    expect(phase).toBe("notRecording");
  });

  it("tells a waiting toolbar how the recorder ended, and then nothing more", async () => {
    const { toolbar, recorder } = await start();
    const first = (await toolbar({
      kind: "update",
      after: -1,
    })) as RecorderUpdate;
    const waiting = toolbar({ kind: "update", after: first.revision });

    recorder.end();
    await recorder.done;

    const last = (await waiting) as RecorderUpdate;
    expect(last.state).toMatchObject({
      phase: "ended",
      outcome: { kind: "empty" },
    });
    await expect(
      toolbar({ kind: "update", after: last.revision })
    ).resolves.toBeNull();
  });
});
