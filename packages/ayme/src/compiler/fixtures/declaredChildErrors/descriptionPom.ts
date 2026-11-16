import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

const KIND = "main";

@ayme
export class DescriptionPom {
  @ayme.child({ description: `The ${KIND} heading.` })
  readonly heading!: Locator;
}
