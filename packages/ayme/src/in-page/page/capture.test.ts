// @vitest-environment jsdom
import { expect, it } from "vitest";

import { createRefWorld, type CaptureAriaSnapshot } from "./capture";

/** A dual capture that names each `div` in the body, as Playwright's would mark it. */
const snapshotOfDivs: CaptureAriaSnapshot = (root, { aymeRefs }) => {
  const refsByElement = new Map<Element, string>();
  for (const element of root.querySelectorAll("div")) {
    // Kept while role and name stay, as Playwright's marks are.
    const ref = aymeRefs.marks.get(element)?.ref ?? `e${aymeRefs.next()}`;
    aymeRefs.marks.set(element, { role: "generic", name: "", ref });
    refsByElement.set(element, ref);
  }
  return { distilledText: "", fullText: "", refsByElement };
};

it("drops the refs of elements the page let go of, so a long session does not grow the ref map", () => {
  // A stand-in for WeakRef whose targets the test collects at will.
  const collected = new Set<object>();
  const weakRefOf = <T extends object>(target: T) =>
    ({
      deref: () => (collected.has(target) ? undefined : target),
    }) as WeakRef<T>;
  const world = createRefWorld(snapshotOfDivs, weakRefOf);
  document.body.innerHTML = "<div></div><div></div><div></div>";
  const [first, second] = document.body.querySelectorAll("div");

  world.capture(document.body);
  expect(world.trackedRefs()).toBe(3);

  collected.add(first!);
  collected.add(second!);
  world.capture(document.body);

  expect(world.trackedRefs()).toBe(1);
  expect(world.elementEverNamed("e1")).toBeUndefined();
});

it("keeps naming an element a ref it was given while the element lives", () => {
  const world = createRefWorld(snapshotOfDivs);
  document.body.innerHTML = "<div></div>";
  world.capture(document.body);
  world.capture(document.body);

  expect(world.trackedRefs()).toBe(1);
  expect(world.elementOf("e1")).toBe(document.body.querySelector("div"));
});
