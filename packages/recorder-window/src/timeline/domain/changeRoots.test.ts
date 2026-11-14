import { describe, expect, it } from "vitest";

import { changeRoots } from "./changeRoots";

// The window shows only the roots of what changed: of the nodes a Change
// Tree marks as added, removed or changed, the topmost ones. The trees here
// are in the Recording Package's compact notation, as the engine tells them.

describe("the roots of what changed", () => {
  it("shows a changed node", () => {
    expect(
      changeRoots(`- [ref=e1]:\n  - <changed> [ref=e3] paragraph: "Items: 1"`)
    ).toEqual([{ kind: "changed", element: 'paragraph "Items: 1"' }]);
  });

  it("shows an added list once, not each of its items", () => {
    expect(
      changeRoots(
        [
          "- [ref=e1]:",
          '  - <added> [ref=e7] list "Cart":',
          "    - <added> [ref=e8] listitem: Milk",
          "    - <added> [ref=e9] listitem: Bread",
        ].join("\n")
      )
    ).toEqual([{ kind: "added", element: 'list "Cart"' }]);
  });

  it("leaves out a marked node under a marked node, however deep", () => {
    expect(
      changeRoots(
        [
          "- [ref=e1]:",
          '  - <changed> [ref=e2] region "Basket":',
          "    - [ref=e3] list:",
          "      - <removed> [ref=e4] listitem: Milk",
        ].join("\n")
      )
    ).toEqual([{ kind: "changed", element: 'region "Basket"' }]);
  });

  it("shows each root of its own branch, in the order of the page", () => {
    expect(
      changeRoots(
        [
          "- [ref=e1]:",
          '  - <added> [ref=e3] button "New"',
          "  - [ref=e5] navigation:",
          '    - <changed> [ref=e6] link "Cart (1)" [cursor=pointer]:',
          "      - /url: /cart",
          "  - <removed> [ref=e2]",
        ].join("\n")
      )
    ).toEqual([
      { kind: "added", element: 'button "New"' },
      { kind: "changed", element: 'link "Cart (1)" [cursor=pointer]' },
      { kind: "removed", element: "element" },
    ]);
  });

  it("reads a node whose change is also its target's mark", () => {
    expect(
      changeRoots(
        '- [ref=e1]:\n  - <trigger> <changed> [ref=e2] button "Pay" [disabled]'
      )
    ).toEqual([{ kind: "changed", element: 'button "Pay" [disabled]' }]);
  });

  it("reads a name that holds a colon or a quote", () => {
    expect(
      changeRoots(
        [
          "- [ref=e1]:",
          '  - <added> [ref=e2] heading "Total: 3 \\"items\\"" [level=2]:',
          '    - text: "Total: 3"',
          '  - <changed> [ref=e3] status: "Saved: yes"',
        ].join("\n")
      )
    ).toEqual([
      { kind: "added", element: 'heading "Total: 3 \\"items\\"" [level=2]' },
      { kind: "changed", element: 'status "Saved: yes"' },
    ]);
  });

  it("reads a colon or a quote after an escaped quote inside a name as the name's", () => {
    expect(
      changeRoots(
        '- [ref=e1]:\n  - <added> [ref=e2] heading "Say \\"hi: there\\" now" [level=2]'
      )
    ).toEqual([
      { kind: "added", element: 'heading "Say \\"hi: there\\" now" [level=2]' },
    ]);
  });

  it("names a marked node that has only a text by its text", () => {
    expect(changeRoots(`- [ref=e1]:\n  - <added>: Saved`)).toEqual([
      { kind: "added", element: '"Saved"' },
    ]);
  });

  it("takes a node marked only as the Interaction's target for no change", () => {
    expect(
      changeRoots('- [ref=e1]:\n  - <trigger> [ref=e2] button "Pay"')
    ).toEqual([]);
  });

  it("passes over a line that is no node", () => {
    expect(
      changeRoots("- [ref=e1]:\n\n  - <changed> [ref=e3] status: Saved\n")
    ).toEqual([{ kind: "changed", element: 'status "Saved"' }]);
  });

  it("shows nothing for a tree that marks nothing", () => {
    expect(changeRoots(`- [ref=e1]:\n  - [ref=e2] text: Hello`)).toEqual([]);
  });
});
