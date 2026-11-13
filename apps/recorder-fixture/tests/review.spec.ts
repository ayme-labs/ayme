import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Recording } from "./fixtures";

// Ticket #1279: leaving entries out of the recording while paused, and
// putting them back, on real Chromium and the stock Playwright: the package
// on disk says what was decided.

/** The recorder's phase and entries, as a subscriber is told them. */
function watch({ recorder }: Recording) {
  const seen = {
    phase: "",
    commands: [] as readonly string[],
    entries: [] as { id: string; discarded: boolean }[],
  };
  recorder.subscribe(({ state }) => {
    seen.phase = state.phase;
    seen.commands = state.commands;
    seen.entries = state.visits
      .flatMap((visit) => visit.entries)
      .map((entry) => ({ id: entry.id, discarded: entry.discarded === true }));
  });
  return seen;
}

test.describe("discarding and restoring entries", () => {
  test("discards a navigation and restores a click, keeps both through Continue, and Finish writes them into the package with the later Visit intact", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/shop.html");
    const { recorder, page, person } = recording;
    const seen = watch(recording);
    await recorder.send({ type: "record" });
    // The click that leaves the page, and one on the page it led to.
    await person.click(page.locator("#checkout"));
    await page.waitForURL(/checkout\.html$/);
    await person.pause();
    await person.click(page.locator("#pay"));
    await expect(page.getByText("Paid", { exact: true })).toBeVisible();
    await expect
      .poll(() => seen.entries.map((entry) => entry.id))
      .toEqual(["interaction_1", "interaction_2"]);
    // Nothing is decided while recording.
    expect(
      await recorder.send({ type: "discard", entry: "interaction_1" })
    ).toBe("ignored");

    await recorder.send({ type: "stop" });
    await expect.poll(() => seen.phase).toBe("paused");
    expect(seen.commands).toEqual([
      "finish",
      "continue",
      "clear",
      "discard",
      "restore",
      "highlight",
      "clearHighlight",
    ]);
    expect(
      await recorder.send({ type: "discard", entry: "interaction_1" })
    ).toBe("applied");
    expect(
      await recorder.send({ type: "discard", entry: "interaction_2" })
    ).toBe("applied");
    expect(
      await recorder.send({ type: "restore", entry: "interaction_2" })
    ).toBe("applied");
    expect(seen.entries).toEqual([
      { id: "interaction_1", discarded: true },
      { id: "interaction_2", discarded: false },
    ]);

    // The decision survives going on, and pausing again.
    await recorder.send({ type: "continue" });
    expect(seen.phase).toBe("recording");
    expect(seen.entries[0]).toEqual({ id: "interaction_1", discarded: true });
    await recorder.send({ type: "stop" });
    await expect.poll(() => seen.phase).toBe("paused");

    expect(await recorder.send({ type: "finish" })).toBe("applied");
    const outcome = await recorder.done;
    if (outcome.kind !== "saved") throw new Error("Nothing was saved.");
    const text = await readFile(join(outcome.folder, "package.yaml"), "utf8");

    // The navigation is a stub, in its place.
    expect(text).toMatch(
      /\n {6}- kind: interaction\n {8}timestamp: [\d.]+\n {8}discarded: true\n {8}interaction:\n {10}id: interaction_1\n {10}type: click\n {2}- visitId: visit_2\n/
    );
    expect(text.match(/discarded: true/g)).toHaveLength(1);
    // The Visit it led to is as it was, with the click that was restored.
    const second = text.slice(text.indexOf("  - visitId: visit_2"));
    expect(second).toContain("cause: navigate");
    expect(second).toMatch(/baselineTree:\n(.*\n)+?\s+timelineEntries:/);
    expect(second).toMatch(
      /- kind: interaction\n\s+timestamp: [\d.]+\n\s+interaction:\n\s+id: interaction_2\n\s+type: click\n\s+targetRef: \w+\n\s+targetSelector: .*Pay/
    );
    expect(second).toMatch(/<changed> \[ref=\w+\] paragraph: Paid/);
  });

  test("Clear drops the decisions, and a recording in which everything was discarded still saves", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/cart.html");
    const { recorder, page, person } = recording;
    const seen = watch(recording);
    await recorder.send({ type: "record" });
    await person.click(page.locator("#add"));
    await expect(page.getByText("Items: 1")).toBeVisible();
    await expect.poll(() => seen.entries).toHaveLength(1);
    await recorder.send({ type: "stop" });
    await expect.poll(() => seen.phase).toBe("paused");
    expect(
      await recorder.send({ type: "discard", entry: "interaction_1" })
    ).toBe("applied");

    expect(await recorder.send({ type: "clear" })).toBe("applied");
    await expect.poll(() => seen.phase).toBe("notRecording");
    expect(seen.entries).toEqual([]);

    // The next recording's first click has the same id, and no decision.
    await recorder.send({ type: "record" });
    await person.click(page.locator("#add"));
    await expect(page.getByText("Items: 2")).toBeVisible();
    await expect
      .poll(() => seen.entries)
      .toEqual([{ id: "interaction_1", discarded: false }]);
    await recorder.send({ type: "stop" });
    await expect.poll(() => seen.phase).toBe("paused");
    await recorder.send({ type: "discard", entry: "interaction_1" });

    expect(await recorder.send({ type: "finish" })).toBe("applied");
    const outcome = await recorder.done;
    if (outcome.kind !== "saved") throw new Error("Nothing was saved.");
    const text = await readFile(join(outcome.folder, "package.yaml"), "utf8");
    expect(text.match(/visitId:/g)).toHaveLength(1);
    expect(text.match(/- kind: /g)).toHaveLength(1);
    expect(text).toMatch(
      /\n {6}- kind: interaction\n {8}timestamp: [\d.]+\n {8}discarded: true\n {8}interaction:\n {10}id: interaction_1\n {10}type: click\ntraceActionPoints:/
    );
    expect(
      (await readFile(join(outcome.folder, "trace.zip")))
        .subarray(0, 2)
        .toString()
    ).toBe("PK");
  });
});
