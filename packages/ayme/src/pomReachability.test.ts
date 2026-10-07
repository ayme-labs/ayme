import type { Locator } from "@playwright/test";
import { describe, expect, test, vi } from "vitest";

const { probePomRootState } =
  await vi.importActual<typeof import("./pomReachability")>(
    "./pomReachability"
  );

function rootLocator(evaluate: (callback: () => unknown) => Promise<unknown>) {
  return {
    count: async () => 1,
    isVisible: async () => true,
    evaluate,
  } as unknown as Locator;
}

describe("probePomRootState", () => {
  test("its in-page callback carries no bundler helpers", async () => {
    let source = "";
    await probePomRootState(
      rootLocator(async (callback) => {
        source = callback.toString();
        return { present: true, available: true };
      })
    );
    expect(source).not.toContain("__name");
  });

  test("a root detached during the probe reads as absent", async () => {
    const locator = rootLocator(async () => {
      throw new Error("locator.evaluate: Element is not attached to the DOM");
    });
    await expect(probePomRootState(locator)).resolves.toEqual({
      present: false,
      available: false,
    });
  });

  test("a callback that references a missing helper fails loudly", async () => {
    const locator = rootLocator(async () => {
      throw new Error(
        "locator.evaluate: ReferenceError: __name is not defined"
      );
    });
    await expect(probePomRootState(locator)).rejects.toThrow("ReferenceError");
  });
});
