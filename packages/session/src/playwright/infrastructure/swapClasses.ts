/** What a Swap uses of a Node Host's runtime: its own registrations, which
 * keep the page's registry, so a Page Object keeps its id. */
export type NodeHostPom = {
  register(model: unknown): unknown;
  unregister(model: unknown): void;
};

/**
 * Swaps the classes `running` on `pom` for `rebuilt`: every old one leaves
 * first, since a rebuilt class keeps its name and the registry refuses two
 * of one name. When a rebuilt class throws as it registers, the old ones
 * come back and the error is thrown.
 */
export function swapClasses(
  pom: NodeHostPom,
  running: readonly unknown[],
  rebuilt: readonly unknown[]
): void {
  for (const model of running) pom.unregister(model);
  const registered: unknown[] = [];
  try {
    for (const model of rebuilt) {
      pom.register(model);
      registered.push(model);
    }
  } catch (error) {
    for (const model of registered) pom.unregister(model);
    for (const model of running) pom.register(model);
    throw error;
  }
}
