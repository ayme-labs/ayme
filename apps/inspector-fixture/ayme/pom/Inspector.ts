// The dogfood page registers the Inspector's Page Object with the runtime,
// which only a test or a dogfooding page does (ADR-0057 keeps apps out).
// A relative path, not `@ayme-dev/inspector/testing`: a Session of the
// `ayme` command loads an installed package's entry without building it, and
// this entry is TypeScript source.
// eslint-disable-next-line testing-entries/no-restricted-imports
import { Inspector as InspectorPom } from "../../../../packages/inspector/testing/index";
import type { Page } from "@playwright/test";

/**
 * The Inspector's Page Object as the dogfood page registers it, found with
 * plain CSS: mounted for dogfooding, the panel sits in an open shadow root,
 * which CSS pierces, so the runtime's page needs no selector engine. It keeps
 * the name, so its tools are `Inspector.*`.
 */
export class Inspector extends InspectorPom {
  constructor(page: Page) {
    super(page, page.locator("[data-ayme-inspector-root]"));
  }
}
