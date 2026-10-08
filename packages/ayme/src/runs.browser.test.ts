import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callers,
  createAyme,
  createPage,
  RuntimeStateError,
  type Ayme,
  type Run,
} from "./index";

const SAVE = { target: "role=button[name='Save']" };

describe("The Run log, ayme.runs, in Chromium", () => {
  let ayme: Ayme;
  let stop: () => void;

  beforeEach(() => {
    document.body.innerHTML = "<main><button>Save</button></main>";
    ayme = createAyme({ pageFactory: () => createPage() });
    stop = ayme.start();
  });

  afterEach(() => {
    stop();
    document.body.innerHTML = "";
  });

  /** The Runs this test started, past the ones earlier tests left. */
  function runsSince(before: readonly Run[]): readonly Run[] {
    const earlier = new Set(before.map((run) => run.id));
    return ayme.runs.list().filter((run) => !earlier.has(run.id));
  }

  it("records a Run for the app by default and for a named Caller", async () => {
    const before = ayme.runs.list();
    const startedAt = Date.now();

    const byDefault = await ayme.tools.run("click", SAVE);
    const named = await ayme.tools.run("click", SAVE, {
      by: "support-assistant",
    });

    const runs = runsSince(before);
    expect(runs).toEqual([
      expect.objectContaining({
        tool: "click",
        input: SAVE,
        by: callers.app,
        status: "succeeded",
        result: byDefault,
      }),
      expect.objectContaining({
        tool: "click",
        input: SAVE,
        by: "support-assistant",
        status: "succeeded",
        result: named,
      }),
    ]);
    expect(runs[0]!.id).not.toBe(runs[1]!.id);
    for (const run of runs) {
      expect(run.startedAt).toBeGreaterThanOrEqual(startedAt);
      expect(run.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("lists a Run as running when its turn starts, and tells subscribers when it starts, gains an Interaction and ends", async () => {
    const before = ayme.runs.list();
    const heard: (readonly Run[])[] = [];
    const unsubscribe = ayme.runs.subscribe(() =>
      heard.push(runsSince(before))
    );

    await ayme.tools.run("click", SAVE, { by: callers.inspector });
    unsubscribe();
    await ayme.tools.run("click", SAVE);

    expect(heard).toHaveLength(3);
    const [started, clicked, ended] = heard;
    expect(started).toEqual([
      expect.objectContaining({
        tool: "click",
        by: callers.inspector,
        status: "running",
      }),
    ]);
    expect(started![0]).not.toHaveProperty("durationMs");
    expect(clicked).toEqual([
      expect.objectContaining({
        id: started![0]!.id,
        status: "running",
        interactions: [expect.objectContaining({ operation: "click" })],
      }),
    ]);
    expect(ended).toEqual([
      expect.objectContaining({
        id: started![0]!.id,
        status: "succeeded",
        durationMs: expect.any(Number),
      }),
    ]);
  });

  it("reports a subscriber that throws apart, and runs and records the Run as usual", async () => {
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("listener broke");
    const unsubscribe = ayme.runs.subscribe(() => {
      throw failure;
    });
    const before = ayme.runs.list();

    let reports: unknown[][];
    try {
      await expect(ayme.tools.run("click", SAVE)).resolves.toMatchObject({
        page_changed: expect.any(Boolean),
      });
    } finally {
      unsubscribe();
      reports = reported.mock.calls;
      reported.mockRestore();
    }

    expect(runsSince(before)).toEqual([
      expect.objectContaining({ tool: "click", status: "succeeded" }),
    ]);
    expect(reports).toContainEqual([expect.any(String), failure]);
  });

  it("records a failed Run with its error text, and still throws the Ayme error", async () => {
    const before = ayme.runs.list();
    const missing = { target: "role=button[name='Delete']" };

    const error = await ayme.tools
      .run("click", missing, { by: "support-assistant" })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(Error);
    const { name, message } = error as Error;
    expect(runsSince(before)).toEqual([
      expect.objectContaining({
        tool: "click",
        input: missing,
        by: "support-assistant",
        status: "failed",
        error: `${name}: ${message}`,
        durationMs: expect.any(Number),
      }),
    ]);
    expect(runsSince(before)[0]).not.toHaveProperty("result");
  });

  it("records a Run of a tool that is not live as failed, and still throws", async () => {
    const before = ayme.runs.list();

    const error = await ayme.tools
      .run("Nowhere.save", {}, { by: "support-assistant" })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(RuntimeStateError);
    expect(runsSince(before)).toEqual([
      expect.objectContaining({
        tool: "Nowhere.save",
        input: {},
        by: "support-assistant",
        status: "failed",
        error: 'RuntimeStateError: The tool "Nowhere.save" is not live.',
        durationMs: expect.any(Number),
      }),
    ]);
  });

  it("records a Run started while the session is stopped as failed, and still throws", async () => {
    stop();
    const before = ayme.runs.list();

    const error = await ayme.tools
      .run("click", SAVE)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(RuntimeStateError);
    expect(runsSince(before)).toEqual([
      expect.objectContaining({
        tool: "click",
        input: SAVE,
        by: callers.app,
        status: "failed",
        error:
          'RuntimeStateError: Cannot run the tool "click": the Ayme runtime session is not started.',
      }),
    ]);
  });

  it("keeps the result as it returned, whatever happens to the returned value later", async () => {
    const before = ayme.runs.list();

    const snapshot = await ayme.tools.run("snapshot", {});
    const structure = snapshot.structure;
    (snapshot as { structure: string }).structure = "changed later";

    expect(runsSince(before)[0]!.result).toMatchObject({ structure });
  });

  it("keeps the newest 200 Runs", async () => {
    const first = await ayme.tools
      .run("snapshot", {}, { by: "first" })
      .then(() => ayme.runs.list().at(-1)!);
    for (let index = 0; index < 200; index++)
      await ayme.tools.run("snapshot", {});

    const runs = ayme.runs.list();
    expect(runs).toHaveLength(200);
    expect(runs.map((run) => run.id)).not.toContain(first.id);
    expect(runs.every((run) => run.by === callers.app)).toBe(true);
  });
});
