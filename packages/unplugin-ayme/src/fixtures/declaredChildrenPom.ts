import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme({ root: (self: Row) => self.root })
class Row {
  readonly root!: Locator;
}

@ayme({ root: (self: Toolbar) => self.root })
class Toolbar {
  readonly root!: Locator;
}

type Rows = Promise<Row[]>;

@ayme
export class DeclaredChildrenPom {
  @ayme.child
  readonly heading!: Locator;

  @ayme.child({ description: "The message " + `shown without runs.` })
  get emptyMessage(): Locator {
    return undefined as unknown as Locator;
  }

  @ayme.collection({ description: "One cell per column." })
  readonly cells!: Locator;

  @ayme.collection
  get links(): Locator {
    return undefined as unknown as Locator;
  }

  @ayme.child({ description: "Filters the runs." })
  readonly toolbar!: Toolbar;

  @ayme.child()
  get footer(): Toolbar {
    return undefined as unknown as Toolbar;
  }

  @ayme.collection({ description: "One row per run." })
  async rows(): Promise<Row[]> {
    return [];
  }

  @ayme.collection
  async readonlyRows(): Promise<readonly Row[]> {
    return [];
  }

  @ayme.collection({})
  async aliasedRows(): Rows {
    return [];
  }

  @ayme.collection
  visibleRows(): readonly Row[] {
    return [];
  }

  // Undeclared members are still inferred until declarations are required.
  readonly inferred!: Locator;
}
