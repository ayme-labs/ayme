import { describe, expect, it, vi } from "vitest";
import {
  AriaRefSchema,
  MonotonicTimeMsSchema,
  PageIdSchema,
  StructuralTree,
  SyntheticAriaRefFactory,
  type StructuralActionId,
} from "@ayme-dev/core/structural-observation";
import { createCursors } from "../domain/cursors";
import { InteractionHistory } from "../domain/interactionHistory";
import { PageStateSession, type ActionPage } from "./pageStateSession";
import type { PomLabels } from "../domain/pomLabels";
import type { PageCapture } from "../domain/structuralPageState";

const ref = AriaRefSchema.parse;

let now = 0;
const clock = { now: () => MonotonicTimeMsSchema.parse(++now) };
const cursor = () => createCursors().of("app");

/** A page that settles at once and never starts a full load. */
const settledPage: ActionPage = {
  settle: async () => ({ stable: true }),
  watchFullLoad: () => ({ started: new Promise(() => {}), stop: () => {} }),
};

/** An element as the session sees one: something its captures map refs to. */
const element = (name: string) => ({ name }) as unknown as Element;

function capture(
  yaml: string,
  elements: [ref: string, element: Element][] = [],
  pomLabels: PomLabels = new Map()
): PageCapture {
  return {
    tree: StructuralTree.fromAriaSnapshotYaml(
      yaml,
      new SyntheticAriaRefFactory()
    ),
    elementsByRef: new Map(elements.map(([key, value]) => [ref(key), value])),
    pomLabels,
  };
}

/** A page on which every action starts a full load of `url` at once. */
const loadingPage = (url: string): ActionPage => ({
  settle: async () => ({ stable: true }),
  watchFullLoad: () => ({ started: Promise.resolve(url), stop: () => {} }),
});

/**
 * A session whose captures are `captures`, in order, the last one repeated;
 * an error is a capture that throws it. `count()` is how many it took.
 */
function sessionOver(...captures: (PageCapture | Error)[]) {
  return sessionOn(settledPage, ...captures);
}

/** `sessionOver` on `page`. */
function sessionOn(page: ActionPage, ...captures: (PageCapture | Error)[]) {
  let taken = 0;
  const session = new PageStateSession(
    new InteractionHistory({
      pageId: PageIdSchema.parse("document_1"),
      url: "https://app.test/",
      clock,
    }),
    async () => {
      const next = captures[Math.min(taken++, captures.length - 1)]!;
      if (next instanceof Error) throw next;
      return next;
    },
    page
  );
  return { session, count: () => taken };
}

describe("a capture in which two nodes share a ref", () => {
  const a = element("A");
  const b = element("B");
  const shared = capture(
    '- generic [ref=e1]:\n  - button "A" [ref=e2]\n  - button "B" [ref=e2]',
    [
      ["e2", a],
      ["e2", b],
    ]
  );
  const valid = capture('- generic [ref=e1]:\n  - button "A" [ref=e2]', [
    ["e2", a],
  ]);

  it("is rejected, and the next valid capture resolves the ref", async () => {
    const { session } = sessionOver(shared, valid);

    await expect(session.getPageStateCapture()).rejects.toThrow(
      "more than one node the Structural Ref e2"
    );
    await session.getPageStateCapture();

    await expect(session.resolveRefs([ref("e2")])).resolves.toEqual([
      {
        status: "resolved",
        requestedRef: ref("e2"),
        node: { ref: ref("e2"), element: a },
      },
    ]);
  });

  it("is rejected after a valid capture without disturbing its refs", async () => {
    const { session } = sessionOver(valid, shared, valid);

    await session.getPageStateCapture();
    await expect(session.getPageStateCapture()).rejects.toThrow(
      "more than one node the Structural Ref e2"
    );

    await expect(session.resolveRefs([ref("e2")])).resolves.toEqual([
      {
        status: "resolved",
        requestedRef: ref("e2"),
        node: { ref: ref("e2"), element: a },
      },
    ]);
  });

  it("is still shown by a look, which records nothing", async () => {
    const { session } = sessionOver(shared);

    await expect(session.look()).resolves.toMatchObject({
      text: expect.stringContaining('e2 button "B"'),
    });
    expect(session.history.hasObservation).toBe(false);
  });
});

it("resolves a ref against the capture the identity ledger last reconciled when another capture interleaves", async () => {
  const original = element("original");
  const replacement = element("replacement");
  const snapshot = (body: string, button: string, target: Element) =>
    capture(
      `- generic [ref=${body}]:\n  - button "Captured omitted" [ref=${button}]`,
      [[button, target]]
    );
  const { session } = sessionOver(
    snapshot("e1", "e2", original),
    snapshot("e1", "e2", original),
    snapshot("e3", "e4", replacement)
  );
  await session.getPageStateCapture();

  // The resolution's own capture still shows e2; the interleaved capture,
  // recorded before the ledger is read, re-renders the button as e4.
  const [resolutions] = await Promise.all([
    session.resolveRefs([ref("e2")]),
    session.getPageStateCapture(),
  ]);

  expect(resolutions).toEqual([
    {
      status: "resolved",
      requestedRef: ref("e2"),
      node: { ref: ref("e4"), element: replacement },
    },
  ]);
});

describe("the ref the latest page state gave an element", () => {
  const overlay = element("overlay");
  const holder = element("holder");
  const pane = element("pane");

  it("is nothing before the session has recorded a page state", async () => {
    const { session } = sessionOver(capture("- generic [ref=e1]"));

    await session.look();

    expect(session.latestRefOf(overlay)).toBeUndefined();
  });

  it("is the ref the latest page state gave the element itself", async () => {
    const { session } = sessionOver(
      capture(
        "- generic [ref=e1]:\n  - generic [ref=e2]\n  - generic [ref=e3]",
        [
          ["e2", overlay],
          ["e3", holder],
        ]
      )
    );

    await session.getPageState();

    expect(session.latestRefOf(overlay)).toBe(ref("e2"));
    expect(session.latestRefOf(holder)).toBe(ref("e3"));
    expect(session.latestRefOf(pane)).toBeUndefined();
  });

  it("is nothing for an element the page state gave two refs", async () => {
    const { session } = sessionOver(
      capture(
        "- generic [ref=e1]:\n  - generic [ref=e2]\n  - generic [ref=e3]",
        [
          ["e2", overlay],
          ["e3", overlay],
        ]
      )
    );

    await session.getPageState();

    expect(session.latestRefOf(overlay)).toBeUndefined();
    expect(session.latestElementOf(ref("e3"))).toBe(overlay);
  });
});

describe("an action's before capture", () => {
  const page = '- generic [ref=e1]:\n  - button "Save" [ref=e2]';

  /** The latest observation as the action's `perform` runs, right after its before capture. */
  async function latestAsPerformed(session: PageStateSession) {
    let latest = session.history.latestObservation;
    await session.runAction(cursor(), { tool: "click", args: {} }, () => {
      latest = session.history.latestObservation;
    });
    return latest!;
  }

  it("records nothing when the page and its labels are as last recorded", async () => {
    const { session } = sessionOver(capture(page));

    expect(await latestAsPerformed(session)).toBe(
      session.history.firstObservation
    );
  });

  it("records a before when only a Page Object label changed", async () => {
    const { session } = sessionOver(
      capture(page),
      capture(page, [], new Map([[ref("e2"), ["SaveButton"]]]))
    );

    const before = await latestAsPerformed(session);

    expect(before).not.toBe(session.history.firstObservation);
    expect(session.history.pomLabels(before)).toEqual(
      new Map([[ref("e2"), ["SaveButton"]]])
    );
  });
});

describe("runAction", () => {
  const savePage = capture('- generic [ref=e1]:\n  - button "Save" [ref=e2]');
  const call = { tool: "App.save", args: {} };

  it("answers with what the action changed", async () => {
    const { session } = sessionOver(
      savePage,
      savePage,
      capture(
        '- generic [ref=e1]:\n  - button "Save" [ref=e2]\n  - status [ref=e3]: Saved'
      )
    );

    await expect(
      session.runAction(cursor(), call, () => "done")
    ).resolves.toMatchObject({
      result: "done",
      page_changed: true,
      settled: true,
      changes: expect.stringContaining("Saved"),
    });
  });

  it("completes the action as failed when the post-action capture throws", async () => {
    const captureError = new Error("Capture failed.");
    const { session, count } = sessionOver(savePage, savePage, captureError);

    await expect(session.runAction(cursor(), call, () => {})).rejects.toBe(
      captureError
    );

    await expectOneFailedCompletedAction(session);
    // Recorded against the last observation: no capture after the failed one.
    expect(count()).toBe(3);
  });

  it("completes the action as failed, before it runs, with the page as last recorded when the before capture throws", async () => {
    const captureError = new Error("Capture failed.");
    const { session, count } = sessionOver(savePage, captureError);
    const perform = vi.fn();

    await expect(session.runAction(cursor(), call, perform)).rejects.toBe(
      captureError
    );

    expect(perform).not.toHaveBeenCalled();
    // The failure's own capture is the third; it fails too and the page as
    // last recorded stands in.
    await expectOneFailedCompletedAction(session);
    expect(count()).toBe(3);
    expect(await session.history.latestObservation!.tree.resolve()).toEqual(
      await session.history.firstObservation!.tree.resolve()
    );
  });

  it("completes the action as failed when perform and the capture after it throw", async () => {
    const { session, count } = sessionOver(
      savePage,
      savePage,
      new Error("Capture failed.")
    );
    const performError = new Error("Save failed.");

    await expect(
      session.runAction(cursor(), call, () => {
        throw performError;
      })
    ).rejects.toBe(performError);

    await expectOneFailedCompletedAction(session);
    expect(count()).toBe(3);
  });

  it("leaves the cursor where it was when perform throws something that is not an Error", async () => {
    const { session } = sessionOver(
      savePage,
      savePage,
      capture(
        '- generic [ref=e1]:\n  - button "Save" [ref=e2]\n  - status [ref=e3]: Failed'
      )
    );
    const reader = cursor();
    const thrown = { reason: "Save failed." };

    await expect(
      session.runAction(reader, call, () => {
        throw thrown;
      })
    ).rejects.toBe(thrown);

    expect(thrown).toEqual({ reason: "Save failed." });
    expect(reader.current()).toBeUndefined();
  });

  it("answers at once when the action starts a full load, and moves the cursor to the page as it was then", async () => {
    const { session } = sessionOn(
      loadingPage("https://app.test/next"),
      savePage
    );
    const reader = cursor();

    await expect(session.runAction(reader, call, () => {})).resolves.toEqual({
      page_changed: false,
      settled: false,
      loading: "https://app.test/next",
      next: "The page is loading https://app.test/next. Call snapshot next to read the new page.",
    });
    expect(reader.current()).toBe(session.history.latestObservation);
  });

  it("still answers a full load when capturing the page as it goes away throws", async () => {
    const { session } = sessionOn(
      loadingPage("https://app.test/next"),
      savePage,
      savePage,
      new Error("The document is gone.")
    );
    const reader = cursor();

    await expect(
      session.runAction(reader, call, () => {})
    ).resolves.toMatchObject({
      page_changed: false,
      settled: false,
      loading: "https://app.test/next",
    });
    expect(reader.current()).toBeUndefined();
  });
});

async function expectOneFailedCompletedAction(session: PageStateSession) {
  const [[actionId, action]] = [...session.history.actions()] as [
    [StructuralActionId, unknown],
  ];
  expect(action).toMatchObject({ failed: true });
  // Core has evidence only for a completed action; a started one throws.
  await expect(
    session.history.observations.getActionEvidence(actionId)
  ).resolves.toBeDefined();
}
