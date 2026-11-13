import type {
  RecorderUpdate,
  ToolbarMessage,
} from "@ayme-dev/recorder/contract";
import { describe, expect, it } from "vitest";

import { openPageRecorderChannel } from "./pageRecorderChannel";

const update = (revision: number): RecorderUpdate => ({
  revision,
  state: {
    phase: "recording",
    visits: [],
    commands: ["stop"],
    warnings: [],
  },
});

/** The function the engine puts in the page, played by the test: it answers
 * each request for an update with the next of `answers`, then with null, as
 * once the recorder has ended. */
function pageFunction(answers: RecorderUpdate[]) {
  const asked: ToolbarMessage[] = [];
  let ended!: () => void;
  const done = new Promise<void>((resolve) => (ended = resolve));
  return {
    asked,
    done,
    call: (message: ToolbarMessage) => {
      asked.push(message);
      if (message.kind === "send") return Promise.resolve("applied");
      const next = answers.shift() ?? null;
      if (!next) ended();
      return Promise.resolve(next);
    },
  };
}

/** Every revision the listener heard, until the recorder ended. */
async function heard(page: ReturnType<typeof pageFunction>) {
  const told: number[] = [];
  openPageRecorderChannel(page.call).subscribe((update) =>
    told.push(update.revision)
  );
  await page.done;
  return told;
}

describe("the toolbar's channel through the page", () => {
  it("asks for the state first, then each time for an update above the newest it heard", async () => {
    const page = pageFunction([update(3), update(4)]);

    expect(await heard(page)).toEqual([3, 4]);
    expect(page.asked).toEqual([
      { kind: "update", after: -1 },
      { kind: "update", after: 3 },
      { kind: "update", after: 4 },
    ]);
  });

  it("ignores a state that arrives late, once a newer one was heard", async () => {
    const page = pageFunction([update(3), update(2), update(4)]);

    expect(await heard(page)).toEqual([3, 4]);
  });

  it("sends a command and gives its answer", async () => {
    const page = pageFunction([]);

    await expect(
      openPageRecorderChannel(page.call).send({ type: "record" })
    ).resolves.toBe("applied");
    expect(page.asked).toEqual([{ kind: "send", command: { type: "record" } }]);
  });

  it("stops asking once unsubscribed", async () => {
    let answer!: (update: RecorderUpdate) => void;
    const asked: ToolbarMessage[] = [];
    const told: number[] = [];
    const unsubscribe = openPageRecorderChannel((message) => {
      asked.push(message);
      return new Promise((resolve) => (answer = resolve));
    }).subscribe((heard) => told.push(heard.revision));

    unsubscribe();
    answer(update(1));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(told).toEqual([]);
    expect(asked).toHaveLength(1);
  });
});
