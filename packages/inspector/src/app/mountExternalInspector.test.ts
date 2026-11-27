import { expect, it } from "vitest";

import { sessionLost } from "./mountExternalInspector";

it("the Inspector of a Session that it lost names the Session, and how to get it back in a window or in an Agent App's chat", () => {
  expect(sessionLost("shop", false)).toBe(
    "This Inspector lost the Session shop. Start it again with ayme -s=shop open, then run ayme -s=shop inspect."
  );
  expect(sessionLost("shop", true)).toBe(
    "This Inspector lost the Session shop. Start it again with ayme -s=shop open, then ask your agent to show the Inspector again."
  );
});
