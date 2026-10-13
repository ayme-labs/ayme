import { describe, expect, it } from "vitest";
import { AriaRefSchema } from "./StructuralTypes";
import {
  isSyntheticRef,
  parseStructuralRef,
  refAttribute,
  refFromAttribute,
  refFromSelector,
  refWrittenOtherwise,
  selectorForRef,
  SYNTHETIC_ROOT_REF,
  syntheticRef,
  syntheticRefsAbsentFrom,
} from "./StructuralRef";

describe("Structural Ref grammar", () => {
  it.each([
    ["e1", "e1"],
    ["e12", "e12"],
    ["s_root", "s_root"],
    ["s_1", "s_1"],
    ["s_webmcp_parse_1", "s_webmcp_parse_1"],
    ["e", undefined],
    ["x1", undefined],
    ["E1", undefined],
    ["e1 ", undefined],
    ["s_", undefined],
    ["s_a b", undefined],
    ["role=button", undefined],
    ["#save", undefined],
    ["aria-ref=e1", undefined],
    ["", undefined],
  ])("parses %j as %j", (text, ref) => {
    expect(parseStructuralRef(text)).toBe(ref);
  });

  it.each([
    ["e12", false],
    ["s_root", true],
    ["s_1", true],
    ["s_webmcp_parse_1", true],
  ])("says whether %s is synthetic: %s", (ref, synthetic) => {
    expect(isSyntheticRef(AriaRefSchema.parse(ref))).toBe(synthetic);
  });

  it("builds the aria-ref selector for a ref", () => {
    expect(selectorForRef(AriaRefSchema.parse("e12"))).toBe("aria-ref=e12");
  });

  it.each([
    ["aria-ref=e12", "e12"],
    ["locator('aria-ref=e2')", "e2"],
    ['locator("aria-ref=s_root")', "s_root"],
    ["getByRole('button', { name: 'Save' })", undefined],
    ['role=button[name="Save"]', undefined],
    ["aria-ref=", undefined],
    ["aria-ref=x1", undefined],
    ["aria-ref=e12junk", undefined],
    ["getByText('aria-ref=s_root')", undefined],
    ["locator('aria-ref=e2').first()", undefined],
    ["#list aria-ref=e2", undefined],
  ])("reads the ref out of %j as %j", (selector, ref) => {
    expect(refFromSelector(selector)).toBe(ref);
  });

  it("reads back the ref its own selector names", () => {
    for (const text of ["e7", "s_root", "s_webmcp_parse_3"]) {
      const ref = AriaRefSchema.parse(text);
      expect(refFromSelector(selectorForRef(ref))).toBe(ref);
    }
  });

  it.each([
    ["root", "s_root"],
    [1, "s_1"],
    ["webmcp_parse_3", "s_webmcp_parse_3"],
  ])("mints the synthetic ref named %j as %j", (name, ref) => {
    const minted = syntheticRef(name);
    expect(minted).toBe(ref);
    expect(parseStructuralRef(minted)).toBe(minted);
    expect(isSyntheticRef(minted)).toBe(true);
  });

  it.each(["", "a b", "-1"])(
    "refuses to mint a synthetic ref named %j",
    (name) => {
      expect(() => syntheticRef(name)).toThrow(
        `"${name}" cannot name a synthetic Structural Ref.`
      );
    }
  );

  it("names the root fragment's synthetic ref", () => {
    expect(SYNTHETIC_ROOT_REF).toBe("s_root");
  });

  it.each([
    ["ref=e12", "e12"],
    ["ref=s_root", "s_root"],
    ["ref=a", "a"],
    ["active", undefined],
    ["level=2", undefined],
    ["aria-ref=e1", undefined],
  ])("reads the ref the snapshot attribute %j names as %j", (content, ref) => {
    expect(refFromAttribute(content)).toBe(ref);
  });

  it("reads back the ref its own snapshot attribute names", () => {
    for (const text of ["e7", "s_root", "s_webmcp_parse_3"]) {
      const ref = AriaRefSchema.parse(text);
      expect(refAttribute(ref)).toBe(`ref=${text}`);
      expect(refFromAttribute(refAttribute(ref))).toBe(ref);
    }
  });

  it.each([
    ["[ref=e5]", "e5"],
    ["[ ref = e5 ]", "e5"],
    ["ref=e5", "e5"],
    ["REF=E5", "e5"],
    ["E5", "e5"],
    [" e5 ", "e5"],
    ["e5", "e5"],
    ["  [ref=e12]\n", "e12"],
    ["#save", undefined],
    ["button.save", undefined],
    ['role=button[name="Save"]', undefined],
    ["aria-ref=e5", undefined],
    ["[ref=e5] button", undefined],
    ["ref=x5", undefined],
    ["[ref=s_1]", undefined],
    ["e", undefined],
    ["", undefined],
  ])("reads %j, a ref written another way, as %j", (text, ref) => {
    expect(refWrittenOtherwise(text)).toBe(ref);
  });

  it("allocates synthetic refs that do not occur in the text", () => {
    const text =
      '- generic:\n  - button "Save" [ref=s_tmp_1]\n  - text: "s_tmp_2"';
    const refs = syntheticRefsAbsentFrom(text, "tmp_");
    const allocated = [refs.create(), refs.create()];
    expect(allocated).toEqual(["s_tmp_3", "s_tmp_4"]);
    for (const ref of allocated) {
      expect(isSyntheticRef(ref)).toBe(true);
      expect(text).not.toContain(ref);
    }
  });
});
