import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { CartPage } from "../.ayme/pom/CartPage";
import { CheckoutPage } from "../.ayme/pom/CheckoutPage";
import { GesturesPage } from "../.ayme/pom/GesturesPage";
import { HelpPage } from "../.ayme/pom/HelpPage";
import { LatePage } from "../.ayme/pom/LatePage";
import { LeavingPage } from "../.ayme/pom/LeavingPage";
import { ShopPage } from "../.ayme/pom/ShopPage";
import { expect, test, type Recording } from "./fixtures";

const expected = (name: string) =>
  readFile(new URL(`./expected/${name}`, import.meta.url), "utf8");

/** A package's text without what differs from run to run. */
const comparable = (text: string) =>
  text
    .replaceAll(/rec_[0-9TZ]+/g, "rec_<id>")
    .replace(/^createdAt: .*$/m, "createdAt: <time>")
    .replaceAll(/http:\/\/127\.0\.0\.1:\d+/g, "http://127.0.0.1:<port>")
    .replaceAll(/(timestamp|startedAt|endedAt): [\d.]+/g, "$1: <time>")
    // Where the trace holds a snapshot is the stock trace tool's number.
    .replaceAll(/(SnapshotId): "\d+"/g, '$1: "<position>"');

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
    const cart = new CartPage(page);
    expect(await recorder.send({ type: "record" })).toBe("applied");

    await person.click(cart.addItemButton);
    await expect(cart.itemCount).toHaveText("Items: 1");
    await person.pause();
    // The page re-creates the "Add item" button.
    await person.click(cart.redrawButton);
    await expect.poll(() => cart.redraws()).toBe(1);
    await person.pause();
    await person.click(cart.addItemButton);
    await expect(cart.itemCount).toHaveText("Items: 2");

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
    // The three clicks: the focus each one's press moved is its own.
    expect(timestamps).toHaveLength(3);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  test("a Visit's first snapshot is the page as it stood just before the first Interaction", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/late.html");
    const { recorder, page, person } = recording;
    const orders = new LatePage(page);
    await recorder.send({ type: "record" });
    // The page goes on rendering after Record, before anything is done on it.
    await orders.showOffer();
    await expect(orders.offer).toBeVisible();

    await person.click(orders.refreshButton);
    await expect(orders.refreshState).toHaveText("Refreshed");

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
        `traceActionPoints:`,
      ].join("\n")
    );
    expect(text).not.toContain("kind: change");
  });

  test("only the final click is held back: pressing, dragging and selecting text behave as without the recorder", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/gestures.html");
    const { recorder, page, person } = recording;
    const gesturesPage = new GesturesPage(page);
    // A person goes on when the page has got the click that ends a gesture.
    const clicked = (id: string) =>
      expect.poll(() => gesturesPage.lastEvent()).toBe(`click ${id}`);
    const gestures = async () => {
      // A press the page reacts to before any click.
      await person.click(gesturesPage.holdButton);
      await expect(gesturesPage.held).toHaveText(/^Released/);
      await clicked("hold");
      // A drag of the slider's handle.
      const handle = await person.middleOf(gesturesPage.handle);
      await person.drag(handle, { x: handle.x + 120, y: handle.y });
      await expect(gesturesPage.position).toHaveText("Handle at 120");
      await clicked("handle");
      // A selection made by dragging across the text.
      const text = (await gesturesPage.text.boundingBox())!;
      const line = text.y + text.height / 2;
      await person.drag(
        { x: text.x + 2, y: line },
        { x: text.x + 150, y: line }
      );
      await clicked("text");
    };
    const pageNow = () => gesturesPage.state();

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
    const shop = new ShopPage(page);
    const checkout = new CheckoutPage(page);
    await recorder.send({ type: "record" });

    await person.click(shop.checkoutLink);
    await page.waitForURL(/checkout\.html$/);
    await person.pause();
    // The new page goes on rendering before anything is done on it.
    await checkout.showOffer();
    await expect(checkout.offer).toBeVisible();
    // Its first click is held like any other.
    await person.click(checkout.payButton);
    await expect(checkout.paymentState).toHaveText("Paid");

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
    await person.click(new ShopPage(page).helpLink);
    const help = await opening;
    await help.waitForURL(/help\.html$/);
    const helpPage = new HelpPage(help);
    await helpPage.thanksButton.waitFor();
    await person.pause();
    await (await personOn(help)).click(helpPage.thanksButton);
    await expect(helpPage.thanked).toHaveText("Thanked 1");

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
    const checkout = new CheckoutPage(page);

    await person.click(new ShopPage(page).checkoutLink);
    await page.waitForURL(/checkout\.html$/);
    await checkout.payButton.waitFor();
    await person.click(checkout.payButton);

    await expect(checkout.paymentState).toHaveText("Paid");
  });

  test("a click held when its page goes away is never passed on to the page after it, and the recording still saves", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/leaving.html");
    const { recorder, page, person } = recording;
    const leaving = new LeavingPage(page);
    const checkout = new CheckoutPage(page);
    await recorder.send({ type: "record" });
    // A recording with no Interaction saves nothing: one comes first.
    await person.click(leaving.stayButton);
    await expect(leaving.stayed).toHaveText("Stayed");
    await person.pause();

    // The page goes elsewhere as the mouse is released, and the click is
    // held in the page it leaves.
    await person.click(leaving.leaveButton);
    await page.waitForURL(/checkout\.html$/);
    await checkout.payButton.waitFor();
    await person.pause();

    expect(await checkout.clicks()).toBe(0);
    const { text } = await finish(recording);
    expect(text).toContain("  - visitId: visit_2");
  });
});
