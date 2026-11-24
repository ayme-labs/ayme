import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { CartPage } from "../ayme/pom/CartPage";
import { SettlingPage } from "../ayme/pom/SettlingPage";
import { TickingPage } from "../ayme/pom/TickingPage";
import { expect, test, type Recording } from "./fixtures";

/** The recorder's phase and Visits, as a subscriber is told them. */
function watch({ recorder }: Recording) {
  const seen = { phase: "", interactions: 0, visits: 0 };
  recorder.subscribe(({ state }) => {
    seen.phase = state.phase;
    seen.visits = state.visits.length;
    seen.interactions = state.visits
      .flatMap((visit) => visit.entries)
      .filter((entry) => entry.kind === "interaction").length;
  });
  return seen;
}

/** The Change Tree of each Interaction a saved recording has, by the text
 * its target selector holds; "" for one with no Change Tree, undefined for
 * one that is not there. */
async function changesBy({ recorder }: Recording, target: string) {
  const outcome = await recorder.done;
  if (outcome.kind !== "saved") throw new Error("Nothing was saved.");
  const text = await readFile(join(outcome.folder, "package.yaml"), "utf8");
  return text
    .split("traceActionPoints:")[0]!
    .split("\n      - kind: ")
    .filter((entry) =>
      /targetSelector: (.*)/.exec(entry)?.[1]?.includes(target)
    )
    .map((entry) => entry.split("changeTree:")[1] ?? "");
}

test.describe("the recorder's controls", () => {
  test("Stop pauses: a click made while paused reaches the page untouched and is not recorded, and Continue resumes into the same timeline", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/cart.html");
    const { recorder, page, person } = recording;
    const cart = new CartPage(page);
    const seen = watch(recording);
    expect(await recorder.send({ type: "record" })).toBe("applied");
    await person.click(cart.addItemButton);
    await expect(cart.itemCount).toHaveText("Items: 1");
    await expect.poll(() => seen.interactions).toBe(1);

    expect(await recorder.send({ type: "stop" })).toBe("applied");
    await expect.poll(() => seen.phase).toBe("paused");
    // Nothing of this click is recorded, however long a report of it is
    // given to arrive.
    await person.click(cart.addItemButton);
    await expect(cart.itemCount).toHaveText("Items: 2");
    await person.pause();
    expect(seen.interactions).toBe(1);

    // Playwright's recorder was switched off by its mode, not stopped: it
    // reports again.
    expect(await recorder.send({ type: "continue" })).toBe("applied");
    expect(seen.phase).toBe("recording");
    await person.click(cart.addItemButton);
    await expect(cart.itemCount).toHaveText("Items: 3");
    await expect.poll(() => seen.interactions).toBe(2);

    expect(await recorder.send({ type: "finish" })).toBe("applied");
    const outcome = await recorder.done;
    if (outcome.kind !== "saved") throw new Error("Nothing was saved.");
    const text = await readFile(join(outcome.folder, "package.yaml"), "utf8");
    expect(text.match(/visitId:/g)).toHaveLength(1);
    expect(text.match(/kind: interaction/g)).toHaveLength(2);
    // What the page changed while paused is in no entry: neither a change
    // of its own, nor part of what the next Interaction changed. The page
    // as it stood at Continue is the point to compare from.
    expect(text).not.toContain("Items: 2");
    expect(text).not.toContain("kind: change");
    expect(text).toContain('<changed> [ref=e3] paragraph: "Items: 3"');
  });

  test("Clear leaves no entry behind, and the next recording holds only what came after it", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/cart.html");
    const { recorder, page, person, projectDir } = recording;
    const cart = new CartPage(page);
    const seen = watch(recording);
    await recorder.send({ type: "record" });
    await person.click(cart.addItemButton);
    await expect.poll(() => seen.interactions).toBe(1);

    expect(await recorder.send({ type: "clear" })).toBe("applied");
    await expect.poll(() => seen.phase).toBe("notRecording");
    expect(seen).toEqual({ phase: "notRecording", interactions: 0, visits: 0 });
    // Not recording: the page gets its input untouched.
    await person.click(cart.addItemButton);
    await expect(cart.itemCount).toHaveText("Items: 2");

    expect(await recorder.send({ type: "record" })).toBe("applied");
    await person.click(cart.redrawButton);
    await expect.poll(() => seen.interactions).toBe(1);
    await recorder.send({ type: "finish" });
    const outcome = await recorder.done;

    if (outcome.kind !== "saved") throw new Error("Nothing was saved.");
    const text = await readFile(join(outcome.folder, "package.yaml"), "utf8");
    expect(text.match(/kind: interaction/g)).toHaveLength(1);
    expect(text).toContain("id: interaction_1");
    expect(text).toContain(
      `targetSelector: internal:role=button[name="Redraw"i]`
    );
    expect(
      (await readdir(join(projectDir, "ayme", "recordings"))).sort()
    ).toEqual(["latest.yaml", outcome.folder.split("/").at(-1)]);
  });

  test("Finish resolves the outcome once, and every waiter gets the same one", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/cart.html");
    const { recorder, page, person, projectDir } = recording;
    const cart = new CartPage(page);
    // A waiter from before anything was recorded.
    const early = recorder.done;
    await recorder.send({ type: "record" });
    await person.click(cart.addItemButton);
    await expect(cart.itemCount).toHaveText("Items: 1");
    await person.pause();

    expect(await recorder.send({ type: "finish" })).toBe("applied");
    expect(await recorder.send({ type: "finish" })).toBe("ignored");

    const [first, second, late] = await Promise.all([
      early,
      recorder.done,
      recorder.done,
    ]);
    expect(first.kind).toBe("saved");
    expect(second).toEqual(first);
    expect(late).toEqual(first);
    expect(await recorder.done).toEqual(first);
    // Saved once.
    const recordings = await readdir(join(projectDir, "ayme", "recordings"));
    expect(recordings.filter((name) => name.startsWith("rec_"))).toHaveLength(
      1
    );
  });

  test("Finish on a started recording with no Interactions ends with 'empty' and writes no package", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/cart.html");
    const { recorder, projectDir } = recording;
    await recorder.send({ type: "record" });

    expect(await recorder.send({ type: "finish" })).toBe("applied");

    expect(await recorder.done).toEqual({ kind: "empty" });
    await expect(readdir(join(projectDir, "ayme"))).rejects.toThrow(/ENOENT/);
  });

  test("a click made after Stop, while an earlier click's page still changes, is recorded with its own change and not credited to the earlier click", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/settling.html");
    const { recorder, page, person } = recording;
    const settling = new SettlingPage(page);
    const seen = watch(recording);
    expect(await recorder.send({ type: "record" })).toBe("applied");

    await person.click(settling.loadButton);
    // The click reached the page, so the recorder heard of it: it sent it
    // on. Stop comes after that, as a person's does; one sent within the
    // milliseconds the page's message takes is no person's.
    await expect(settling.results).not.toHaveCount(0);
    expect(await recorder.send({ type: "stop" })).toBe("applied");
    await person.click(settling.markButton);
    const phase = seen.phase;
    const results = await settling.results.count();
    await expect(settling.markState).toHaveText("Marked");
    // The timing this needs: the first click's page was still changing,
    // and "Paused" did not show yet, when the second click reached it.
    expect(results).toBeLessThan(10);
    expect(phase).toBe("wrappingUp");
    await expect(settling.results).toHaveCount(10);
    await expect.poll(() => seen.phase, { timeout: 10_000 }).toBe("paused");
    expect(await recorder.send({ type: "finish" })).toBe("applied");

    const [load] = await changesBy(recording, "Load results");
    const [mark] = await changesBy(recording, "Mark");
    // As while recording, the first click ends where the second starts, so
    // what the page goes on changing after the second is the second's.
    expect(load).toBeTruthy();
    expect(load).not.toContain("Marked");
    expect(mark).toContain("Marked");
    expect(mark).toContain("Result 10");
  });

  test("a click made after Stop, before 'Paused' shows, is saved when the terminal stops the recorder right after", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/ticking.html");
    const { recorder, page, person } = recording;
    const ticking = new TickingPage(page);
    const seen = watch(recording);
    expect(await recorder.send({ type: "record" })).toBe("applied");
    // Stop while the page still changes after a click: the wrap-up waits for
    // it to settle, and "Paused" shows only then. On a quiet page it shows
    // a few milliseconds after Stop, too soon for a person to click.
    await person.click(ticking.startButton);
    const started = Date.now();
    // The click reached the page, so the recorder heard of it, before Stop.
    await expect(ticking.ticks).not.toHaveText("Ticks: 0");
    expect(await recorder.send({ type: "stop" })).toBe("applied");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await person.click(ticking.stopButton);
    const after = Date.now() - started;
    const phase = seen.phase;
    // Ctrl+C in the terminal, at once.
    recorder.end();
    await expect(ticking.state).toHaveText("Stopped");
    // The timing this needs: the click came while the first click's page
    // was still given time to settle, which ends two seconds in on a page
    // that never goes quiet, so the pages still held clicks back; and
    // "Paused" did not show yet.
    expect(after).toBeLessThan(2_000);
    expect(phase).toBe("wrappingUp");

    expect(await changesBy(recording, "Start ticking")).toHaveLength(1);
    const [stop] = await changesBy(recording, "Stop ticking");
    expect(stop).toContain("Stopped");
  });
});
