import { describe, expect, it } from "vitest";

import type { RecorderUpdate } from "./index";
import { startScriptedRecorder } from "./testing";
import { entryId, inputId, pageId } from "./test-utils/ids";

// Ticket #1278: the hover highlight through the handle, on the scripted
// browser: what the handle answers, and what it asks the browser to draw.

const idle = [`- generic [ref=e1]:`, `  - button "Save" [ref=e2]`].join("\n");
const click = {
  type: "click",
  selector: 'internal:role=button[name="Save"i]',
  target: { ref: "e2", tree: idle },
  values: { button: "left" },
};

async function oneClickRecorded(after = idle) {
  const { recorder, browser } = await startScriptedRecorder({
    url: "http://shop.test/",
  });
  browser.showPage(idle);
  const updates: RecorderUpdate[] = [];
  recorder.subscribe((update) => updates.push(update));
  await recorder.send({ type: "record" });
  browser.holdClick();
  await browser.asks({
    kind: "waitForSettled",
    page: pageId("page_1"),
    input: inputId("input_1"),
  });
  browser.showPage(after);
  browser.settle();
  browser.report(click);
  await expect
    .poll(() => updates.at(-1)!.state.visits[0]?.entries.length)
    .toBe(1);
  return { recorder, browser, latest: () => updates.at(-1)! };
}

describe("the hover highlight", () => {
  it("highlights an entry's element on its page, then clears it, and never changes the timeline", async () => {
    const { recorder, browser, latest } = await oneClickRecorded();
    const before = latest().state.visits;

    await expect(
      recorder.send({ type: "highlight", entry: entryId("interaction_1") })
    ).resolves.toBe("applied");
    // On the page it is still on, exactly its element, by its ref.
    expect(browser.highlighted).toEqual({
      page: pageId("page_1"),
      find: { by: "ref", ref: "e2" },
    });

    await expect(recorder.send({ type: "clearHighlight" })).resolves.toBe(
      "applied"
    );
    expect(browser.highlighted).toBeNull();
    expect(latest().state.visits).toBe(before);
    recorder.end();
    await recorder.done;
  });

  it("answers 'notFound' and highlights nothing for an element the page no longer has", async () => {
    const { recorder, browser } = await oneClickRecorded();
    await recorder.send({ type: "highlight", entry: entryId("interaction_1") });

    await expect(
      recorder.send({ type: "highlight", entry: entryId("change_9") })
    ).resolves.toBe("notFound");

    expect(browser.highlighted).toBeNull();
    recorder.end();
    await recorder.done;
  });

  it("highlights the element of a row of an entry's changes by its ref, and answers 'notFound' for a row the entry does not have", async () => {
    const { recorder, browser } = await oneClickRecorded(
      `${idle}\n  - status [ref=e3]: Saved`
    );

    await expect(
      recorder.send({
        type: "highlight",
        entry: entryId("interaction_1"),
        row: 0,
      })
    ).resolves.toBe("applied");
    expect(browser.highlighted).toEqual({
      page: pageId("page_1"),
      find: { by: "ref", ref: "e3" },
    });

    await expect(
      recorder.send({
        type: "highlight",
        entry: entryId("interaction_1"),
        row: 1,
      })
    ).resolves.toBe("notFound");
    expect(browser.highlighted).toBeNull();
    recorder.end();
    await recorder.done;
  });

  it("answers 'notFound' for a row's element the page no longer shows", async () => {
    const { recorder, browser } = await oneClickRecorded(
      `${idle}\n  - status [ref=e3]: Saved`
    );
    browser.showPage(idle);

    await expect(
      recorder.send({
        type: "highlight",
        entry: entryId("interaction_1"),
        row: 0,
      })
    ).resolves.toBe("notFound");
    expect(browser.highlighted).toBeNull();
    recorder.end();
    await recorder.done;
  });

  it("clears the highlight when the recorder ends", async () => {
    const { recorder, browser } = await oneClickRecorded();
    await recorder.send({ type: "highlight", entry: entryId("interaction_1") });

    await recorder.send({ type: "finish" });
    await recorder.done;

    expect(browser.highlighted).toBeNull();
  });
});
