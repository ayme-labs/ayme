import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Recording } from "./fixtures";
import { stockTraceTool } from "./stockTrace";

/** Presses Finish and reads the package the recorder says it saved. */
async function finish({ recorder }: Recording) {
  expect(await recorder.send({ type: "finish" })).toBe("applied");
  const outcome = await recorder.done;
  if (outcome.kind !== "saved") throw new Error("Nothing was saved.");
  return {
    folder: outcome.folder,
    text: await readFile(join(outcome.folder, "package.yaml"), "utf8"),
  };
}

/** The positions a package gives for each Interaction. */
function positionsIn(text: string) {
  return [
    ...text.matchAll(
      /- interactionId: (\w+)\n\s+pageId: \w+\n\s+beforeSnapshotId: "(\d+)"\n\s+afterSnapshotId: "(\d+)"/g
    ),
  ].map(([, id, before, after]) => ({
    id: id!,
    before: before!,
    after: after!,
  }));
}

test.describe("the trace of a recording", () => {
  test("opens an Interaction's before and after with the stock trace tool, by the package's own position numbers", async ({
    startRecording,
  }) => {
    const recording = await startRecording("/cart.html");
    const { recorder, page, person } = recording;
    await recorder.send({ type: "record" });
    await person.click(page.locator("#add"));
    await expect(page.getByText("Items: 1")).toBeVisible();
    await person.pause();
    await person.click(page.locator("#add"));
    await expect(page.getByText("Items: 2")).toBeVisible();

    const { folder, text } = await finish(recording);

    const points = positionsIn(text);
    expect(points.map(({ id }) => id)).toEqual([
      "interaction_1",
      "interaction_2",
    ]);
    // The trace is beside the package, where the package says it is.
    expect(text).toMatch(
      /^tracePath: .ayme\/recordings\/rec_\w+\/trace\.zip$/m
    );
    const stock = await stockTraceTool();
    try {
      await stock.open(join(folder, "trace.zip"));
      // The expected element is the page's count: what each Interaction
      // started from, and what it ended at.
      const count = "document.getElementById('count').textContent";
      for (const [index, point] of points.entries()) {
        expect(await stock.evaluateAt(point.before, count)).toBe(
          `Items: ${index}`
        );
        expect(await stock.evaluateAt(point.after, count)).toBe(
          `Items: ${index + 1}`
        );
      }
    } finally {
      await stock.close();
    }
  });

  test("`trace latest`, `trace <recording id>` and `trace <path>` open the right trace through the project's own Playwright", async ({
    startRecording,
    runRecorder,
  }) => {
    // Two recordings in one project: one click, then two. The second is the
    // latest, and its trace marks more snapshots.
    const clicks = async (count: number) => {
      const recording = await startRecording("/cart.html");
      const { recorder, page, person } = recording;
      await recorder.send({ type: "record" });
      for (let item = 1; item <= count; item += 1) {
        await person.click(page.locator("#add"));
        await expect(page.getByText(`Items: ${item}`)).toBeVisible();
        await person.pause();
      }
      const { folder } = await finish(recording);
      return { projectDir: recording.projectDir, folder };
    };
    const first = await clicks(1);
    const second = await clicks(2);
    const idOf = (folder: string) => folder.split("/").at(-1)!;

    /** How many snapshots the trace opened by `ayme-recorder trace <args>`
     * marks, by the stock tool's own list of its actions. */
    const marksOpenedBy = async (...args: string[]) => {
      const run = async (...more: string[]) => {
        const process = await runRecorder(["trace", ...more], {
          cwd: first.projectDir,
        });
        const exit = await process.exit;
        return { exit, stdout: process.stdout(), stderr: process.stderr() };
      };
      const opened = await run(...args);
      expect(opened.exit, opened.stderr).toEqual({ code: 0, signal: null });
      const actions = await run("actions");
      expect(actions.exit, actions.stderr).toEqual({ code: 0, signal: null });
      await run("close");
      return actions.stdout.match(/\bsnapshot_\d+\b/g)?.length ?? 0;
    };

    const ofFirst = await marksOpenedBy(idOf(first.folder));
    const ofSecond = await marksOpenedBy("latest");
    expect(ofSecond).toBeGreaterThan(ofFirst);
    // The same trace, by its id and by its path.
    expect(await marksOpenedBy(idOf(second.folder))).toBe(ofSecond);
    expect(await marksOpenedBy(join(first.folder, "trace.zip"))).toBe(ofFirst);
    expect(await marksOpenedBy("open", "latest")).toBe(ofSecond);
  });
});
