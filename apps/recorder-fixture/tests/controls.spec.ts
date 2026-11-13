import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

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

test.describe("the recorder's controls", () => {
  test("Stop pauses: a click made while paused reaches the page untouched and is not recorded, and Continue resumes into the same timeline", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/cart.html");
    const { recorder, page, person } = recording;
    const seen = watch(recording);
    expect(await recorder.send({ type: "record" })).toBe("applied");
    await person.click(page.locator("#add"));
    await expect(page.getByText("Items: 1")).toBeVisible();
    await expect.poll(() => seen.interactions).toBe(1);

    expect(await recorder.send({ type: "stop" })).toBe("applied");
    await expect.poll(() => seen.phase).toBe("paused");
    // Nothing of this click is recorded, however long a report of it is
    // given to arrive.
    await person.click(page.locator("#add"));
    await expect(page.getByText("Items: 2")).toBeVisible();
    await person.pause();
    expect(seen.interactions).toBe(1);

    // Playwright's recorder was switched off by its mode, not stopped: it
    // reports again.
    expect(await recorder.send({ type: "continue" })).toBe("applied");
    expect(seen.phase).toBe("recording");
    await person.click(page.locator("#add"));
    await expect(page.getByText("Items: 3")).toBeVisible();
    await expect.poll(() => seen.interactions).toBe(2);

    expect(await recorder.send({ type: "finish" })).toBe("applied");
    const outcome = await recorder.done;
    if (outcome.kind !== "saved") throw new Error("Nothing was saved.");
    const text = await readFile(join(outcome.folder, "package.yaml"), "utf8");
    expect(text.match(/visitId:/g)).toHaveLength(1);
    expect(text.match(/kind: interaction/g)).toHaveLength(2);
    // The click made while paused shows as what the page looked like when
    // recording went on: a change before the next Interaction.
    expect(text).toContain('paragraph: "Items: 2"');
  });

  test("Clear leaves no entry behind, and the next recording holds only what came after it", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/cart.html");
    const { recorder, page, person, projectDir } = recording;
    const seen = watch(recording);
    await recorder.send({ type: "record" });
    await person.click(page.locator("#add"));
    await expect.poll(() => seen.interactions).toBe(1);

    expect(await recorder.send({ type: "clear" })).toBe("applied");
    await expect.poll(() => seen.phase).toBe("notRecording");
    expect(seen).toEqual({ phase: "notRecording", interactions: 0, visits: 0 });
    // Not recording: the page gets its input untouched.
    await person.click(page.locator("#add"));
    await expect(page.getByText("Items: 2")).toBeVisible();

    expect(await recorder.send({ type: "record" })).toBe("applied");
    await person.click(page.locator("#redraw"));
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
      (await readdir(join(projectDir, ".ayme", "recordings"))).sort()
    ).toEqual(["latest.yaml", outcome.folder.split("/").at(-1)]);
  });

  test("Finish on a started recording with no Interactions ends with 'empty' and writes no package", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/cart.html");
    const { recorder, projectDir } = recording;
    await recorder.send({ type: "record" });

    expect(await recorder.send({ type: "finish" })).toBe("applied");

    expect(await recorder.done).toEqual({ kind: "empty" });
    await expect(readdir(join(projectDir, ".ayme"))).rejects.toThrow(/ENOENT/);
  });
});
