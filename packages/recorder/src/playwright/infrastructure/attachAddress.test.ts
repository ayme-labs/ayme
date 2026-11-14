import { expect, it } from "vitest";

import { notOnePageMessage } from "./attachAddress";

it("says why a browser with no page, or several, is not one the recorder attaches to", () => {
  expect(notOnePageMessage(0)).toBe(
    "The recorder records a browser with exactly one page open, and leaves it as it is. The browser at this address has no page open: open the page to record and attach again."
  );
  expect(notOnePageMessage(3)).toBe(
    "The recorder records a browser with exactly one page open, and leaves it as it is. The browser at this address has 3 pages open: close the others and attach again."
  );
});
