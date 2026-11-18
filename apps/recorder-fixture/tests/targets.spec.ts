import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NestedPage } from "../.ayme/pom/NestedPage";
import { expect, test } from "./fixtures";

/** The ref the package's starting picture gives the element on `line`. */
const refIn = (text: string, line: RegExp) => {
  const [, baseline = ""] = text.split("    baselineTree:\n");
  return new RegExp(`\\[ref=(\\w+)\\] ${line.source}`).exec(
    baseline.split("    timelineEntries:")[0]!
  )?.[1];
};

/** Each Interaction's type and target ref, in order. */
const targetsOf = (text: string) =>
  text
    .split("traceActionPoints:")[0]!
    .split(/\n(?= {6}- kind: )/)
    .filter((block) => block.includes("- kind: interaction"))
    .map((block) => ({
      type: /\n {10}type: (.*)/.exec(block)?.[1],
      button: /\n {10}button: (.*)/.exec(block)?.[1],
      targetRef: /\n {10}targetRef: (.*)/.exec(block)?.[1],
    }));

test.describe("the element a step acted on", () => {
  test("a click inside a link or a button names the link or the button, as Playwright's selector does, whether the page structure lists the element clicked or not; so do a double click and a right-click", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/nested.html");
    const { recorder, page, person } = recording;
    const nested = new NestedPage(page);
    expect(await recorder.send({ type: "record" })).toBe("applied");

    // Each lands on the element the text is in, not on the link or the
    // button around it.
    await person.click(nested.pullRequestsLabel);
    await expect(nested.said).toHaveText("Pull requests opened");
    await person.pause();
    await person.click(nested.repositoryText);
    await expect(nested.said).toHaveText("Repository opened");
    await person.pause();
    await person.click(nested.codeText);
    await expect(nested.said).toHaveText("Code opened");
    await person.pause();
    await person.doubleClick(nested.codeText);
    await expect(nested.said).toHaveText("Code opened twice");
    await person.pause();
    const at = await person.middleOf(nested.codeText);
    const mouse = await page.context().newCDPSession(page);
    for (const type of ["mousePressed", "mouseReleased"] as const)
      await mouse.send("Input.dispatchMouseEvent", {
        type,
        ...at,
        button: "right",
        buttons: type === "mousePressed" ? 2 : 0,
        clickCount: 1,
      });
    await expect(nested.said).toHaveText("Code menu");
    await person.pause();

    expect(await recorder.send({ type: "finish" })).toBe("applied");
    const outcome = await recorder.done;
    if (outcome.kind !== "saved") throw new Error("Nothing was saved.");
    const text = await readFile(join(outcome.folder, "package.yaml"), "utf8");
    const pullRequests = refIn(text, /link "Pull requests 12"/);
    const repository = refIn(text, /link "ayme"/);
    const code = refIn(text, /button "<> Code"/);
    expect([pullRequests, repository, code]).not.toContain(undefined);
    expect(targetsOf(text)).toEqual([
      { type: "click", button: "left", targetRef: pullRequests },
      { type: "click", button: "left", targetRef: repository },
      { type: "click", button: "left", targetRef: code },
      // The double click, reported once.
      { type: "click", button: "left", targetRef: code },
      { type: "click", button: "right", targetRef: code },
    ]);
  });
});
