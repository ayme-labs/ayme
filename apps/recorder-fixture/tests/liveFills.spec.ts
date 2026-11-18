import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TimelineEntry } from "@ayme-dev/recorder/contract";

import { InputsPage } from "../.ayme/pom/InputsPage";
import { LargePage } from "../.ayme/pom/LargePage";
import { expect, test, type Recording } from "./fixtures";

/** The recorder's phase, and every list of entries it was shown, in order. */
function watch({ recorder }: Recording) {
  const seen = { phase: "", lists: [] as TimelineEntry[][] };
  recorder.subscribe(({ state }) => {
    seen.phase = state.phase;
    seen.lists.push(state.visits.flatMap((visit) => visit.entries));
  });
  return seen;
}

/** The saved package's Interactions: each one's type, text and lines. */
async function saved({ recorder }: Recording) {
  const outcome = await recorder.done;
  if (outcome.kind !== "saved") throw new Error("Nothing was saved.");
  const text = await readFile(join(outcome.folder, "package.yaml"), "utf8");
  return text
    .split("traceActionPoints:")[0]!
    .split(/\n(?= {6}- kind: )/)
    .filter((block) => block.includes("- kind: interaction"))
    .map((block) => ({
      block,
      type: /\n {10}type: (.*)/.exec(block)?.[1],
      text: /\n {10}text: (.*)/.exec(block)?.[1],
      changes: block.split("changeTree:")[1] ?? "",
    }));
}

/** The fill on the Note field in each list of entries that has it, with
 * its place in the list. */
const fillsIn = (lists: readonly TimelineEntry[][]) =>
  lists.flatMap((entries) => {
    const at = entries.findIndex(
      (entry) =>
        entry.kind === "interaction" &&
        entry.interaction.type === "fill" &&
        entry.targetElement?.includes("Note") === true
    );
    const entry = entries[at];
    return entry?.kind === "interaction" ? [{ at, entry }] : [];
  });

test.describe("typing, as it shows and as it is saved", () => {
  test("a fill shows before the page is read again, its text follows every key and its rows each read, it keeps its place and id, and the next action makes it final (rules 1 to 5)", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/large.html");
    const { recorder, page, person } = recording;
    const large = new LargePage(page);
    const seen = watch(recording);
    await expect(large.noteInput).toBeFocused();
    expect(await recorder.send({ type: "record" })).toBe("applied");

    await person.type("abc");
    await expect(large.noteState).toHaveText("Saved");
    // Its rows catch up once the page is read: the fill is there, with
    // changes under it.
    await expect
      .poll(() => fillsIn(seen.lists).at(-1)?.entry.changes ?? null, {
        timeout: 5_000,
      })
      .not.toBeNull();
    const typed = fillsIn(seen.lists);
    await person.click(large.markButton);
    await expect(large.markState).toHaveText("Marked");
    await person.pause();
    const after = fillsIn(seen.lists).slice(typed.length);

    // It showed before the page was read after it: its text, no changes.
    expect(typed[0]!.entry.changes).toBeNull();
    // Its text followed the keys, one prefix after another, to the last.
    // The first key after Record can be held while the page is read, so
    // the fill may first show more than one key.
    const texts = typed.map(({ entry }) => String(entry.interaction["text"]));
    expect(texts.every((text) => "abc".startsWith(text))).toBe(true);
    expect(texts.at(-1)).toBe("abc");
    expect(JSON.stringify(typed.at(-1)!.entry.changes)).toContain("Saved");
    // One entry, in one place, under one id.
    expect(new Set(typed.map(({ entry }) => entry.id)).size).toBe(1);
    expect(new Set(typed.map(({ at }) => at)).size).toBe(1);
    // The click made it final: it did not change after.
    for (const later of after) expect(later).toEqual(typed.at(-1));

    expect(await recorder.send({ type: "finish" })).toBe("applied");
    const entries = await saved(recording);
    const fill = entries.find((entry) => entry.type === "fill");
    expect(fill?.text).toBe("abc");
    expect(fill?.changes).toContain("Saved");
    expect(fill?.changes).not.toContain("Marked");
  });

  test("Stop keeps a fill's last text, and Clear removes it for good (rule 6)", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/large.html");
    const { recorder, page, person } = recording;
    const large = new LargePage(page);
    const seen = watch(recording);
    await expect(large.noteInput).toBeFocused();
    expect(await recorder.send({ type: "record" })).toBe("applied");

    await person.type("abc");
    expect(await recorder.send({ type: "stop" })).toBe("applied");
    await expect.poll(() => seen.phase, { timeout: 10_000 }).toBe("paused");
    const [stopped] = fillsIn([seen.lists.at(-1)!]);
    expect(stopped?.entry.interaction["text"]).toBe("abc");

    expect(await recorder.send({ type: "clear" })).toBe("applied");
    await expect
      .poll(() => seen.phase, { timeout: 10_000 })
      .toBe("notRecording");
    expect(seen.lists.at(-1)).toEqual([]);
    expect(fillsIn([seen.lists.at(-1)!])).toEqual([]);
  });

  test("bug 6: typing more into a field typed in before Stop is recorded after Continue", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/inputs.html");
    const { recorder, page, person } = recording;
    const inputs = new InputsPage(page);
    const seen = watch(recording);
    expect(await recorder.send({ type: "record" })).toBe("applied");
    await person.click(inputs.itemInput);
    await person.type("ab");
    await person.pause();
    expect(await recorder.send({ type: "stop" })).toBe("applied");
    await expect.poll(() => seen.phase).toBe("paused");
    expect(await recorder.send({ type: "continue" })).toBe("applied");

    await person.type("cd");
    await expect(inputs.itemInput).toHaveValue("abcd");
    await person.pause();
    expect(await recorder.send({ type: "finish" })).toBe("applied");

    const fills = (await saved(recording)).filter(
      (entry) => entry.type === "fill"
    );
    expect(fills.map((fill) => fill.text)).toEqual(["ab", "abcd"]);
  });

  for (const ending of ["Finish", "Ctrl+C"] as const)
    test(`bug 7: a click right after typing the page held back while Stop wrapped up is recorded with its own change, then ${ending}`, async ({
      startRecording,
    }) => {
      const recording = await startRecording("/large.html");
      const { recorder, page, person } = recording;
      const large = new LargePage(page);
      const seen = watch(recording);
      await expect(large.noteInput).toBeFocused();
      // The click comes as soon as the key is in: where it goes is known
      // beforehand, and it is sent at once.
      const markAt = await person.middleOf(large.markButton);
      const mouse = await page.context().newCDPSession(page);
      const click = async () => {
        for (const type of ["mousePressed", "mouseReleased"] as const)
          await mouse.send("Input.dispatchMouseEvent", {
            type,
            ...markAt,
            button: "left",
            buttons: type === "mousePressed" ? 1 : 0,
            clickCount: 1,
          });
      };
      expect(await recorder.send({ type: "record" })).toBe("applied");

      // The first key after Record is held while the large page is read.
      await person.type("a");
      expect(await recorder.send({ type: "stop" })).toBe("applied");
      const heldAtStop = (await large.noteInput.inputValue()) === "";
      await expect
        .poll(() => large.noteInput.inputValue(), { intervals: [10] })
        .toBe("a");
      await click();
      const phase = seen.phase;
      const typingSettled = (await large.noteState.textContent()) === "Saved";
      if (ending === "Ctrl+C") recorder.end();
      await expect(large.markState).toHaveText("Marked");
      // The timing this needs: the key was still held when Stop was
      // applied, the page still changed after the typing when the click
      // came, and "Paused" did not show yet.
      expect(heldAtStop).toBe(true);
      expect(typingSettled).toBe(false);
      expect(phase).toBe("wrappingUp");
      if (ending === "Finish") {
        await expect.poll(() => seen.phase, { timeout: 10_000 }).toBe("paused");
        expect(await recorder.send({ type: "finish" })).toBe("applied");
      }

      const entries = await saved(recording);
      const fill = entries.find((entry) => entry.type === "fill");
      const mark = entries.find(
        (entry) => entry.type === "click" && entry.block.includes("Mark")
      );
      expect(fill?.changes).not.toContain("Marked");
      expect(mark?.changes).toContain("Marked");
    });
});
