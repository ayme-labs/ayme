import { describe, expect, it, vi } from "vitest";

const resolvePageStateRefs = vi.hoisted(() => vi.fn());
vi.mock("./pageState", () => ({ resolvePageStateRefs }));

import { resolveRefTarget } from "./refTarget";

const element = {} as Element;
const resolve = (requested: string) =>
  resolveRefTarget("click", requested, {} as Document);

describe("resolveRefTarget", () => {
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
        `The ref "${requested}" is not a Structural Ref. Pass a ref from snapshot, such as e5.`
      );
    }
  );

  it.each(["[ref=e2]", "ref=e2", "E2", " e2 "])(
    "names the ref %j writes another way",
    async (requested) => {
      await expect(resolve(requested)).rejects.toThrow(
        `The ref "${requested}" is not a Structural Ref. Pass the Structural Ref alone: e2.`
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
});
