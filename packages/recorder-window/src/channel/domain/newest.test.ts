import type { RecorderUpdate } from "@ayme-dev/recorder/contract";
import { describe, expect, it } from "vitest";

import { newest } from "./newest";

const update = (revision: number): RecorderUpdate => ({
  revision,
  state: {
    phase: "notRecording",
    visits: [],
    commands: ["record"],
    warnings: [],
  },
});

describe("the state the window shows", () => {
  it("is the first it hears", () => {
    expect(newest(null, update(3))).toEqual(update(3));
  });

  it("is a newer one when it comes", () => {
    expect(newest(update(3), update(4))).toEqual(update(4));
  });

  it("stays when an older one, or the same one again, comes late", () => {
    const shown = update(4);
    expect(newest(shown, update(3))).toBe(shown);
    expect(newest(shown, update(4))).toBe(shown);
  });
});
