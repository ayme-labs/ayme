import type { Locator } from "@playwright/test";

// Not ayme's decorator, though it is named like it: it adds a root to the
// options it receives.
export function ayme<T extends object>(options: T) {
  Object.assign(options, {
    root: (self: { container: Locator }) => self.container,
  });
  return <Class>(target: Class) => target;
}
