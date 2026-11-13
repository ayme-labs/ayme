import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Recording } from "./fixtures";

/** Presses Finish and reads the package the recorder says it saved. */
async function finish({ recorder }: Recording) {
  expect(await recorder.send({ type: "finish" })).toBe("applied");
  const outcome = await recorder.done;
  if (outcome.kind !== "saved") throw new Error("Nothing was saved.");
  return readFile(join(outcome.folder, "package.yaml"), "utf8");
}

/** A package's entries, each with the lines it was written as. */
function entriesOf(text: string) {
  const [, timeline = ""] = text.split("    timelineEntries:\n");
  return timeline
    .split("traceActionPoints:")[0]!
    .split(/\n(?= {6}- kind: )/)
    .map((block) => ({
      block,
      kind: /- kind: (\w+)/.exec(block)?.[1],
      field: (name: string) =>
        new RegExp(`\\n {10}${name}: (.*)`).exec(block)?.[1],
    }));
}
const interactionsOf = (text: string) =>
  entriesOf(text).filter((entry) => entry.kind === "interaction");

/** The ref the starting picture of the first Visit gives a node. */
const refIn = (text: string, line: RegExp) => {
  const [, baseline = ""] = text.split("    baselineTree:\n");
  return new RegExp(`\\[ref=([\\w]+)\\] ${line.source}`).exec(
    baseline.split("    timelineEntries:")[0]!
  )?.[1];
};

test.describe("every kind of input", () => {
  test("typing, a key press and typing again reach the page in the order they were given, and are recorded so", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/inputs.html");
    const { recorder, page, person } = recording;
    expect(await recorder.send({ type: "record" })).toBe("applied");

    // Quickly, on a page that takes a while to read: each key comes while
    // an earlier input is still held.
    await person.click(page.locator("#item"));
    await person.type("milk");
    await person.press("Enter");
    await person.type("eggs");

    await expect(page.locator("#list li")).toHaveText(["milk"]);
    await expect(page.locator("#item")).toHaveValue("eggs");
    expect(await page.evaluate("window.keys")).toEqual([
      ..."milk",
      "Enter",
      ..."eggs",
    ]);
    await person.pause();

    const interactions = interactionsOf(await finish(recording));
    expect(
      interactions.map((entry) => [entry.field("type"), entry.field("text")])
    ).toEqual([
      ["click", undefined],
      ["fill", "milk"],
      ["press", undefined],
      ["fill", "eggs"],
    ]);
    expect(interactions[2]!.field("key")).toBe("Enter");
    // A newer snapshot closed the click: it is not credited with the typing.
    expect(interactions[0]!.block).not.toContain("milk");
    // The press added "milk" to the list and emptied the field.
    expect(interactions[2]!.block).toContain("listitem");
  });

  test("a choice, an upload, a double click, a click on an unlisted element, inside a frame and a shadow root, and a key with nothing focused are recorded", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/inputs.html");
    const { recorder, page, person } = recording;
    expect(await recorder.send({ type: "record" })).toBe("applied");

    // A choice made by typing on the closed list: "L" picks "Large".
    await page.locator("#size").focus();
    await person.type("l");
    await expect(page.locator("#size")).toHaveValue("Large");
    await person.pause();
    // A file chosen by another client of the browser, as a person's would be.
    await page.locator("#photo").setInputFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from("not really a picture"),
    });
    await person.pause();
    await person.click(page.locator("#star"));
    await expect(page.locator("#starred")).toHaveText("Starred");
    await person.pause();
    await person.doubleClick(page.locator("#twice"));
    await expect(page.locator("#opened")).toHaveText("Opened 1 times");
    await person.pause();
    await person.click(page.frameLocator("#frame").locator("#inner"));
    await expect(page.frameLocator("#frame").locator("#innerSaid")).toHaveText(
      "Inner pressed"
    );
    await person.pause();
    await person.click(page.locator("#shadowed"));
    await expect(page.locator("#shadowSaid")).toHaveText("Shadow pressed");
    await person.pause();
    await page.evaluate("document.activeElement.blur()");
    await person.press("Escape");
    await person.pause();

    const text = await finish(recording);
    const interactions = interactionsOf(text);
    const byType = (type: string) =>
      interactions.filter((entry) => entry.field("type") === type);

    // The choice: the key press that made it, which changed the list, and
    // the choice itself.
    expect(byType("press")[0]!.field("key")).toBe("l");
    expect(byType("press")[0]!.block).toContain("Large");
    expect(byType("select")[0]!.block).toMatch(/options:\n\s+- Large/);
    expect(byType("select")[0]!.field("targetRef")).toBe(
      refIn(text, /combobox "Size"/)
    );
    // The upload, with the name of its file.
    const [upload] = byType("setInputFiles");
    expect(upload!.field("targetSelector")).toMatch(/Photo/i);
    expect(upload!.block).toMatch(/files:\n\s+- photo\.png/);
    expect(byType("fill")).toHaveLength(0);
    const clicks = byType("click");
    // The decoration is marked on the group around it, with its own selector.
    const card = refIn(text, /group "Card"/);
    expect(card).toBeDefined();
    expect(clicks[0]!.field("targetRef")).toBe(card);
    expect(clicks[0]!.field("targetSelector")).not.toContain("Card");
    // One double click, one Interaction.
    expect(clicks[1]!.field("clickCount")).toBe("2");
    expect(clicks[1]!.field("targetRef")).toBe(
      refIn(text, /button "Open twice"/)
    );
    // Inside the frame and the shadow root, refs of the composed tree.
    expect(clicks[2]!.field("targetRef")).toBe(
      refIn(text, /button "Inner button"/)
    );
    expect(clicks[2]!.field("targetRef")).toMatch(/^f\d+e\d+$/);
    expect(clicks[3]!.field("targetRef")).toBe(
      refIn(text, /button "Shadow button"/)
    );
    expect(clicks).toHaveLength(4);
    // A key with nothing focused.
    const escape = byType("press").at(-1)!;
    expect(escape.field("key")).toBe("Escape");
    expect(escape.field("targetRef")).toBe("null");
    expect(escape.field("targetSelector")).toBeDefined();
  });
});
