import { describe, expect, it } from "vitest";
import { AriaRefSchema } from "./StructuralTypes";
import {
  isSyntheticRef,
  parseStructuralRef,
  refFromSelector,
  selectorForRef,
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
});
