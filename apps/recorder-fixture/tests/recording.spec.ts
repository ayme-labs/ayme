import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Recording } from "./fixtures";

const expected = (name: string) =>
  readFile(new URL(`./expected/${name}`, import.meta.url), "utf8");

/** A package's text without what differs from run to run. */
const comparable = (text: string) =>
  text
    .replaceAll(/rec_[0-9TZ]+/g, "rec_<id>")
    .replace(/^createdAt: .*$/m, "createdAt: <time>")
    .replaceAll(/http:\/\/127\.0\.0\.1:\d+/g, "http://127.0.0.1:<port>")
    .replaceAll(/timestamp: [\d.]+/g, "timestamp: <time>");

/** Presses Finish and reads the package the recorder says it saved. */
async function finish({ recorder, projectDir }: Recording) {
  expect(await recorder.send({ type: "finish" })).toBe("applied");
  const outcome = await recorder.done;
  if (outcome.kind !== "saved") throw new Error("Nothing was saved.");
  const recordings = join(projectDir, ".ayme", "recordings");
  return {
    recordings,
    folder: outcome.folder,
    text: await readFile(join(outcome.folder, "package.yaml"), "utf8"),
  };
}

test.describe("recording", () => {
  test("clicks are recorded as Interactions, and Finish writes the released Recording Package", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/cart.html");
    const { recorder, page, person } = recording;
    expect(await recorder.send({ type: "record" })).toBe("applied");

    await person.click(page.locator("#add"));
    await expect(page.getByText("Items: 1")).toBeVisible();
    await person.pause();
    // The page re-creates the "Add item" button.
    await person.click(page.locator("#redraw"));
    await expect.poll(() => page.evaluate("window.redraws")).toBe(1);
    await person.pause();
    await person.click(page.locator("#add"));
    await expect(page.getByText("Items: 2")).toBeVisible();

    const { recordings, folder, text } = await finish(recording);

    // The released location, and the released text: what the prototype of
    // #1268, checked against the released renderer, wrote for these clicks.
    const [recordingId] = /rec_[0-9TZ]+/.exec(text)!;
    expect(folder).toBe(join(recordings, recordingId));
    expect(comparable(text)).toBe(await expected("cart.package.txt"));
    expect(await readFile(join(recordings, "latest.yaml"), "utf8")).toBe(text);
    expect((await readdir(recordings)).sort()).toEqual([
      "latest.yaml",
      recordingId,
    ]);
    const timestamps = [...text.matchAll(/timestamp: ([\d.]+)/g)].map(
      ([, timestamp]) => Number(timestamp)
    );
    expect(timestamps).toHaveLength(5);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  test("a Visit's first snapshot is the page as it stood just before the first Interaction", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/late.html");
    const { recorder, page, person } = recording;
    await recorder.send({ type: "record" });
    // The page goes on rendering after Record, before anything is done on it.
    await page.evaluate("window.showOffer()");
    await expect(page.getByText("Free delivery today")).toBeVisible();

    await person.click(page.locator("#refresh"));
    await expect(page.getByText("Refreshed")).toBeVisible();

    const { text } = await finish(recording);
    expect(text).toContain(
      [
        `visits:`,
        `  - visitId: visit_1`,
        `    url: ${page.url()}`,
        `    cause: initial`,
        `    baselineTree:`,
        `      - [ref=e1]:`,
        `        - [ref=e2] heading "Orders" [level=1]`,
        `        - [ref=e3] button "Refresh" [active]`,
        `        - [ref=e4] paragraph: Never refreshed`,
        `        - [ref=e5] paragraph: Free delivery today`,
        `    timelineEntries:`,
        `      - kind: interaction`,
      ].join("\n")
    );
    // What it rendered before the click is no change of the recording. The
    // click's "after" is the Settled Page: the refresh ends 400 ms after the
    // click, in steps the page's activity tells of.
    expect(text).toContain(
      [
        `          clickCount: 1`,
        `        changeTree:`,
        `          - [ref=e1]:`,
        `            - <changed> [ref=e4] paragraph: Refreshed`,
        `traceActionPoints: []`,
        ``,
      ].join("\n")
    );
    expect(text).not.toContain("kind: change");
  });

  test("only the final click is held back: pressing, dragging and selecting text behave as without the recorder", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/gestures.html");
    const { recorder, page, person } = recording;
    // A person goes on when the page has got the click that ends a gesture.
    const clicked = (id: string) =>
      expect
        .poll(() => page.evaluate("window.events.at(-1)"))
        .toBe(`click ${id}`);
    const gestures = async () => {
      // A press the page reacts to before any click.
      await person.click(page.locator("#hold"));
      await expect(page.locator("#held")).toHaveText(/^Released/);
      await clicked("hold");
      // A drag of the slider's handle.
      const handle = await person.middleOf(page.locator("#handle"));
      await person.drag(handle, { x: handle.x + 120, y: handle.y });
      await expect(page.locator("#position")).toHaveText("Handle at 120");
      await clicked("handle");
      // A selection made by dragging across the text.
      const text = (await page.locator("#text").boundingBox())!;
      const line = text.y + text.height / 2;
      await person.drag(
        { x: text.x + 2, y: line },
        { x: text.x + 150, y: line }
      );
      await clicked("text");
    };
    const pageNow = () =>
      page.evaluate(`({
        events: window.events,
        held: document.getElementById("held").textContent,
        position: document.getElementById("position").textContent,
        selection: String(getSelection()),
      })`) as Promise<{ events: string[]; selection: string }>;

    // Without recording: the page as a person finds it.
    await gestures();
    const unrecorded = await pageNow();
    expect(unrecorded.selection).not.toBe("");
    expect(
      unrecorded.events.filter((event) => event.startsWith("click"))
    ).toEqual(["click hold", "click handle", "click text"]);

    await page.reload();
    await recorder.send({ type: "record" });
    await gestures();

    // Each click reaches the page once, after its press and its release,
    // and nothing more reaches it later.
    await expect.poll(pageNow).toEqual(unrecorded);
    await person.pause();
    expect(await pageNow()).toEqual(unrecorded);
    // All three went through the recorder.
    const { text } = await finish(recording);
    expect(text.match(/kind: interaction/g)).toHaveLength(3);
  });
});

test.describe("Visits", () => {
  test("a click that leaves the page starts a new Visit, which starts from the page as it stood just before its first Interaction", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/shop.html");
    const { recorder, page, person } = recording;
    await recorder.send({ type: "record" });

    await person.click(page.locator("#checkout"));
    await page.waitForURL(/checkout\.html$/);
    await person.pause();
    // The new page goes on rendering before anything is done on it.
    await page.evaluate("window.showOffer()");
    await expect(page.getByText("Free delivery today")).toBeVisible();
    // Its first click is held like any other.
    await person.click(page.locator("#pay"));
    await expect(page.getByText("Paid", { exact: true })).toBeVisible();

    const { text } = await finish(recording);
    // The click that left carries no Change Tree: the next Visit shows
    // where it led.
    expect(text).toMatch(
      /type: click\n\s+targetRef: e\d+\n\s+targetSelector: .*Go to checkout.*\n(\s+\w+: .*\n)* {2}- visitId: visit_2\n/
    );
    expect(text).toContain(
      [
        `  - visitId: visit_2`,
        `    url: ${page.url()}`,
        `    cause: navigate`,
        `    baselineTree:`,
      ].join("\n")
    );
    const second = text.slice(text.indexOf("visit_2"));
    expect(second).toMatch(
      /baselineTree:(\n {6}.*)*paragraph: Free delivery today/
    );
    expect(second).toMatch(
      /changeTree:\n(.*\n)*.*<changed> \[ref=\w+\] paragraph: Paid/
    );
    expect(text).not.toContain("kind: change");
  });

  test("a page opened while recording starts a Visit of its own, and its first click is held", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/shop.html");
    const { recorder, page, person, personOn } = recording;
    await recorder.send({ type: "record" });

    const opening = page.context().waitForEvent("page");
    await person.click(page.locator("#help"));
    const help = await opening;
    await help.waitForURL(/help\.html$/);
    await help.locator("#thanks").waitFor();
    await person.pause();
    await (await personOn(help)).click(help.locator("#thanks"));
    await expect(help.getByText("Thanked 1")).toBeVisible();

    const { text } = await finish(recording);
    const opened = text.slice(text.indexOf(`    url: ${help.url()}`));
    expect(opened).toMatch(/^ {4}url: .*\n {4}cause: openPage\n/);
    expect(opened).toMatch(
      /type: click\n.*\n\s+targetSelector: .*Thanks.*\n(.*\n)*?\s+changeTree:\n(.*\n)*.*paragraph: Thanked 1/
    );
  });

  test("while not recording, the first click on a new page reaches it untouched", async ({
    startRecording,
  }) => {
    const { page, person } = await startRecording("/shop.html");

    await person.click(page.locator("#checkout"));
    await page.waitForURL(/checkout\.html$/);
    await page.locator("#pay").waitFor();
    await person.click(page.locator("#pay"));

    await expect(page.getByText("Paid", { exact: true })).toBeVisible();
  });

  test("a click held when its page goes away is never passed on to the page after it, and the recording still saves", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/leaving.html");
    const { recorder, page, person } = recording;
    await recorder.send({ type: "record" });

    // The page goes elsewhere as the mouse is released, and the click is
    // held in the page it leaves.
    await person.click(page.locator("#leave"));
    await page.waitForURL(/checkout\.html$/);
    await page.locator("#pay").waitFor();
    await person.pause();

    expect(await page.evaluate("window.clicks")).toBe(0);
    const { text } = await finish(recording);
    expect(text).toContain("  - visitId: visit_2");
  });
});
