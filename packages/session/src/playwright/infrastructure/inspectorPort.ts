// The Inspector contract the project's `@ayme-dev/ayme/internal` serves for
// a Node Host: its type is this repository's runtime's, while its value comes
// from the project's own runtime, loaded when the Session hosts a Tab.
import type { InspectorPort } from "@ayme-dev/ayme/internal";

export type { InspectorPort };

/** The port `make` makes, made on its first request or subscription, so a
 * Tab no window shows keeps no contract with its Host. */
export function lazyPort(make: () => InspectorPort): InspectorPort {
  let port: InspectorPort | undefined;
  const portOf = () => (port ??= make());
  return {
    request: (method, params) => portOf().request(method, params),
    subscribe: (listener) => portOf().subscribe(listener),
  };
}
