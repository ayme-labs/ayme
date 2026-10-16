import { describe, expect, it, vi } from "vitest";

const resolvePageStateRefs = vi.hoisted(() => vi.fn());
vi.mock("./pageState", () => ({ resolvePageStateRefs }));

import { resolveRef } from "./refTarget";

const element = {} as Element;
const resolve = (requested: string) =>
  resolveRef(requested, "click", {} as Document);

describe("resolveRef", () => {
  it("resolves a ref to the node it addresses now", async () => {
    const node = { ref: "e4", element };
    resolvePageStateRefs.mockResolvedValueOnce([
      { status: "resolved", requestedRef: "e2", node },
    ]);
    await expect(resolve("e2")).resolves.toBe(node);
  });

  it.each(["#save", "button.save", "e", ""])(
    "refuses %j, which is not a Structural Ref",
    async (requested) => {
      await expect(resolve(requested)).rejects.toThrow(
        `Cannot click ref "${requested}": not a Structural Ref.`
      );
    }
  );

  it.each(["[ref=e2]", "ref=e2", "E2", " e2 "])(
    "names the ref %j writes another way",
    async (requested) => {
      await expect(resolve(requested)).rejects.toThrow(
        `Cannot click ref "${requested}": not a Structural Ref. It writes the Structural Ref e2 another way.`
      );
    }
  );

  it("resolves a synthetic ref like any other", async () => {
    const node = { ref: "s_1", element };
    resolvePageStateRefs.mockResolvedValueOnce([
      { status: "resolved", requestedRef: "s_1", node },
    ]);
    await expect(resolve("s_1")).resolves.toBe(node);
  });

  it("resolves a ref that now names a synthetic node", async () => {
    const node = { ref: "s_3", element };
    resolvePageStateRefs.mockResolvedValueOnce([
      { status: "resolved", requestedRef: "e2", node },
    ]);
    await expect(resolve("e2")).resolves.toBe(node);
  });

  it.each([
    ["unknown-ref", "no snapshot of the current document issued it"],
    ["removed", "it is no longer on the page"],
    ["ambiguous", "it cannot be matched unambiguously to the current page"],
    ["no-element", "it has no element on the page now"],
  ])("says what %s means", async (reason, why) => {
    resolvePageStateRefs.mockResolvedValueOnce([
      { status: "unresolved", requestedRef: "e2", reason },
    ]);
    await expect(resolve("e2")).rejects.toThrow(
      `Cannot click ref "e2": ${why}.`
    );
  });

  it("names why a synthetic ref did not resolve", async () => {
    resolvePageStateRefs.mockResolvedValueOnce([
      { status: "unresolved", requestedRef: "s_1", reason: "removed" },
    ]);
    await expect(resolve("s_1")).rejects.toThrow(
      'Cannot click ref "s_1": it is no longer on the page.'
    );
  });
});
