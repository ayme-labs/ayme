import type { Locator } from "@playwright/test";

/** Decorator options another file imports: the compiler cannot read them. */
export const anchored = {
  root: (self: { container: Locator }) => self.container,
};
