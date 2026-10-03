import type { AriaRef } from "../../../../../packages/ayme/dist/index.mjs";
import { ayme } from "./combined";

// Bare forms.
@ayme
export class BarePom {
  @ayme.action
  open() {}
}

// Options forms, including the empty call.
@ayme({ description: "A page with options." })
export class OptionsPom {
  @ayme.action({ description: "Open it." })
  open() {}

  @ayme.action()
  close() {}
}

// Runtime operations on the same object.
export async function run(ref: AriaRef) {
  const state = await ayme.getPageState();
  const context = await ayme.getPageContext("BarePom");
  const result = await ayme.click(ref);
  return { state, context, result, definitions: ayme.getPomDefinitions() };
}

// A runtime operation used as a decorator must not type-check.
// @ts-expect-error getPageState is not a class decorator.
@ayme.getPageState
export class MisusedClass {}

export class MisusedMember {
  // @ts-expect-error click is not a method decorator.
  @ayme.click
  open() {}
}
