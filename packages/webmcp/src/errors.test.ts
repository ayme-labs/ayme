import { describe, expect, it } from "vitest";

import {
  AymeError,
  RefResolutionError,
  RuntimeStateError,
  ToolInputError,
} from "./errors";
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
  });
});
