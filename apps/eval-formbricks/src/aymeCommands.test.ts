import { describe, expect, it } from "vitest";

import { countAymeCommands } from "./aymeCommands.ts";

const start = (t: string, pid: number, args: string[]) =>
  JSON.stringify({ t, pid, event: "start", args });
const end = (t: string, pid: number, code: number) =>
  JSON.stringify({ t, pid, event: "end", code, stdout: "", stderr: "" });

/** A recording of a task turn sent at 10:00:10. */
const record = [
  // In the setup turn, before the task was sent.
  start("2026-11-27T10:00:05.000Z", 1, ["page-objects"]),
  end("2026-11-27T10:00:05.500Z", 1, 0),
  start("2026-11-27T10:00:11.000Z", 2, ["page-objects"]),
  end("2026-11-27T10:00:11.400Z", 2, 0),
  start("2026-11-27T10:00:12.000Z", 3, [
    "call",
    "SurveyEditorPage.fillSurveyForm",
    "--params",
    '{"surveyName":"x"}',
  ]),
  end("2026-11-27T10:00:13.000Z", 3, 0),
  start("2026-11-27T10:00:14.000Z", 4, [
    "-s=default",
    "call",
    "--params={}",
    "SurveyEditorPage.saveAndClose",
  ]),
  end("2026-11-27T10:00:15.000Z", 4, 1),
  start("2026-11-27T10:00:16.000Z", 5, ["--json", "tools"]),
  end("2026-11-27T10:00:16.300Z", 5, 0),
  // Killed by a signal: it never ended.
  start("2026-11-27T10:00:17.000Z", 6, ["page-objects", "--tab", "http://x"]),
  "not json",
];

describe("the ayme commands of a turn", () => {
  it("counts each command the agent ran in the task turn by its name, a call by its tool, with those that exited with an error or never ended", () => {
    expect(
      countAymeCommands(record, { from: "2026-11-27T10:00:10.000Z" })
    ).toEqual({
      total: 5,
      failed: 2,
      byTool: {
        "ayme call SurveyEditorPage.fillSurveyForm": { total: 1, failed: 0 },
        "ayme call SurveyEditorPage.saveAndClose": { total: 1, failed: 1 },
        "ayme page-objects": { total: 2, failed: 1 },
        "ayme tools": { total: 1, failed: 0 },
      },
    });
  });

  it("counts the setup turn's apart, up to the task", () => {
    expect(
      countAymeCommands(record, { to: "2026-11-27T10:00:10.000Z" })
    ).toEqual({
      total: 1,
      failed: 0,
      byTool: { "ayme page-objects": { total: 1, failed: 0 } },
    });
  });

  it("is nothing for an empty recording", () => {
    expect(countAymeCommands([], {})).toEqual({
      total: 0,
      failed: 0,
      byTool: {},
    });
  });
});
