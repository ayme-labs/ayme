import type { Locator } from "@playwright/test";

import { ayme } from "../page-objects/domain";

/**
 * The root predicate of a test model whose `root` member is its Page Object
 * Root: a model declares it with `ayme({ root: rootOf })(Model)`, as an
 * app's component base class does with `@ayme({ root: rootOf })`.
 */
export const rootOf = (self: { root: Locator }) => self.root;

/** A Page Object Child anchored at `root`, with nothing else: the base of a test's components. */
export class RootedComponent {
  constructor(readonly root: Locator) {}
}
ayme({ root: rootOf })(RootedComponent);

/**
 * A Page Object Child anchored at `root` carrying `members`: what a test
 * writes as a component object literal, declaring its root the way a
 * component class does.
 */
export function rooted<Members extends object>(
  root: Locator,
  members: Members
): RootedComponent & Members {
  return Object.assign(new RootedComponent(root), members);
}
