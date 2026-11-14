import type { RecorderState } from "@ayme-dev/recorder/contract";
import { describe, expect, it } from "vitest";

import { timelineOf } from "./timelineOf";

describe("what the timeline shows of the state", () => {
  it("is nothing before the state is known", () => {
    expect(timelineOf(null)).toEqual({ visits: [], commands: [] });
  });

  it("is the state's Visits and the commands that apply", () => {
    const visits = [
      {
        visitId: "visit_1",
        url: "http://shop.test/",
        cause: "initial",
        entries: [],
      },
    ];
    expect(
      timelineOf({
        phase: "recording",
        visits,
        commands: ["stop"],
        warnings: [],
      } as unknown as RecorderState)
    ).toEqual({ visits, commands: ["stop"] });
  });
});
