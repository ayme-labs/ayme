import { expect, it } from "vitest";

import { RuntimeStateError } from "../shared";
import {
  observePageObjects,
  pageObjectCallerOf,
  pageObjectToolTakesId,
  replacePageObjects,
} from "./session";

// What a Session of the `ayme` command reaches through a runtime session is
// refused on anything else, naming why.
const notASession = { tools: {} } as Parameters<typeof replacePageObjects>[0];

it.each([
  ["replacePageObjects", () => replacePageObjects(notASession, [], [])],
  ["observePageObjects", () => observePageObjects(notASession)],
  ["pageObjectToolTakesId", () => pageObjectToolTakesId(notASession, "a.b")],
  ["pageObjectCallerOf", () => pageObjectCallerOf(notASession, "app")],
])("%s refuses what is not an ayme runtime session", (_, call) => {
  expect(call).toThrow(
    new RuntimeStateError("This is not an ayme runtime session.")
  );
});
