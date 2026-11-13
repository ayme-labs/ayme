import { describe, expect, it } from "vitest";

import { positionsOfSnapshots } from "./traceTool";

// What the stock `playwright trace actions` prints, as run on Playwright 1.62
// and 1.64 for a trace of one page with two snapshot markers: the markers
// are groups that hold one call, which is what a snapshot is opened by.
const actions = [
  `     # Time       Action                                                  Duration`,
  `  ──── ─────────  ─────────────────────────────────────────────────────── ────────`,
  `    1. 0:00.001  Create page                                                207ms`,
  `    2. 0:00.211  Set content                                                 31ms`,
  `    3. 0:00.252  snapshot_1                                                   5ms`,
  `    4. 0:00.252    Evaluate                                                   3ms`,
  `    5. 0:00.257  Evaluate                                                     1ms`,
  `    6. 0:00.259  snapshot_2                                                   2ms`,
  `    7. 0:00.259    Evaluate                                                   1ms`,
  `    8. 0:00.261  Evaluate                                                     1ms`,
].join("\n");

describe("the positions of a trace's snapshots", () => {
  it("are the numbers of the calls inside the markers, as the stock trace tool lists them", () => {
    expect(positionsOfSnapshots(actions)).toEqual({
      snapshot_1: "4",
      snapshot_2: "7",
    });
  });

  it("are none in a trace without markers", () => {
    expect(
      positionsOfSnapshots(actions.split("\n").slice(0, 4).join("\n"))
    ).toEqual({});
  });

  it("leave out a marker that has no call inside it", () => {
    expect(
      positionsOfSnapshots(
        [
          `    3. 0:00.252  snapshot_1                                                   5ms`,
          `    4. 0:00.257  Evaluate                                                     1ms`,
        ].join("\n")
      )
    ).toEqual({});
  });
});
