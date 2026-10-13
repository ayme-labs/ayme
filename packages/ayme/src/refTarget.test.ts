import { describe, expect, it, vi } from "vitest";

const resolvePageStateRefs = vi.hoisted(() => vi.fn());
vi.mock("./pageState", () => ({ resolvePageStateRefs }));

import { resolveRef } from "./refTarget";

const element = {} as Element;
const resolve = (requested: string, synthetic: "allow" | "refuse" = "refuse") =>
  resolveRef(requested, { synthetic }, "click", {} as Document);

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
        `Cannot click ref "${requested}": not a Structural Ref. Pass a ref from snapshot, such as e5.`
      );
    }
  );

  it.each(["[ref=e2]", "ref=e2", "E2", " e2 "])(
    "names the ref %j writes another way",
    async (requested) => {
      await expect(resolve(requested)).rejects.toThrow(
        `Cannot click ref "${requested}": not a Structural Ref. Pass the Structural Ref alone: e2.`
      );
    }
  );

  it("refuses a synthetic ref without resolving it", async () => {
    resolvePageStateRefs.mockClear();
    await expect(resolve("s_1")).rejects.toThrow(
      'Cannot click ref "s_1": synthetic observation-only ref.'
    );
    expect(resolvePageStateRefs).not.toHaveBeenCalled();
  });

  it("refuses a ref that now resolves to a synthetic node", async () => {
    resolvePageStateRefs.mockResolvedValueOnce([
      { status: "resolved", requestedRef: "e2", node: { ref: "s_3", element } },
    ]);
    await expect(resolve("e2")).rejects.toThrow(
      'Cannot click ref "e2": synthetic observation-only ref.'
    );
  });

  it("names why a ref did not resolve", async () => {
    resolvePageStateRefs.mockResolvedValueOnce([
      { status: "unresolved", requestedRef: "e2", reason: "removed" },
    ]);
    await expect(resolve("e2")).rejects.toThrow(
      'Cannot click ref "e2": removed.'
    );
  });

  it("resolves a synthetic ref when the policy allows one", async () => {
    const node = { ref: "s_1", element };
    resolvePageStateRefs.mockResolvedValueOnce([
      { status: "resolved", requestedRef: "s_1", node },
    ]);
    await expect(resolve("s_1", "allow")).resolves.toBe(node);
  });

  it("names why a ref did not resolve, whichever the policy", async () => {
    resolvePageStateRefs.mockResolvedValueOnce([
      { status: "unresolved", requestedRef: "s_1", reason: "removed" },
    ]);
    await expect(resolve("s_1", "allow")).rejects.toThrow(
      'Cannot click ref "s_1": removed.'
    );
  });
});
