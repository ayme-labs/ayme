import { describe, expect, it } from "vitest";

import {
  asSentence,
  AymeError,
  errorText,
  RefResolutionError,
  RuntimeStateError,
  ToolInputError,
} from "./errors";
import { DecisionEndpointError } from "./decisionWire";
import * as publicEntry from "./index";

describe("Ayme errors", () => {
  it.each([
    [ToolInputError, "ToolInputError", "input"],
    [RefResolutionError, "RefResolutionError", "resolution"],
    [RuntimeStateError, "RuntimeStateError", "runtime"],
  ] as const)(
    "%o is an AymeError named after its class with its kind",
    (ErrorClass, name, kind) => {
      const cause = new Error("underlying");
      const error = new ErrorClass("The message.", { cause });

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AymeError);
      expect(error).toBeInstanceOf(ErrorClass);
      expect(error.name).toBe(name);
      expect(error.kind).toBe(kind);
      expect(error.message).toBe("The message.");
      expect(error.cause).toBe(cause);
      expect(String(error)).toBe(`${name}: The message.`);
    }
  );

  it("exports the error classes from the public entry", () => {
    expect(publicEntry.AymeError).toBe(AymeError);
    expect(publicEntry.ToolInputError).toBe(ToolInputError);
    expect(publicEntry.RefResolutionError).toBe(RefResolutionError);
    expect(publicEntry.RuntimeStateError).toBe(RuntimeStateError);
    expect(publicEntry.DecisionEndpointError).toBe(DecisionEndpointError);
  });

  it.each([
    ["It failed", "It failed."],
    ["It failed.", "It failed."],
    ["Did you mean it?", "Did you mean it?"],
    ["Stop!", "Stop!"],
  ])("closes %o as a sentence", (text, sentence) => {
    expect(asSentence(text)).toBe(sentence);
  });

  it("follows an error's text with the Change Record a failed action left on it", () => {
    const error = Object.assign(new TypeError("Timeout 1000ms."), {
      page_changed: true,
      changes_before: "- e2 status: Saved",
      changes: '- e3 dialog "Discard?"',
    });

    expect(errorText(error)).toBe(
      'TypeError: Timeout 1000ms.\n\nchanges_before:\n- e2 status: Saved\n\nchanges:\n- e3 dialog "Discard?"'
    );
    expect(
      errorText(Object.assign(new Error("Failed."), { page_changed: false }))
    ).toBe("Failed.");
  });
});
