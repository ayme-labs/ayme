import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

@ayme
export class UnmarkedMethodsPom {
  constructor(readonly root: Locator) {}

  @ayme.action({ description: "Save." })
  save() {}

  /** Unmarked, though its parameters have a schema. */
  row(name: string): Locator {
    return this.root.getByRole("row", { name });
  }

  /** Unmarked, and its parameter has no schema. */
  each(callback: (row: Locator) => void) {
    callback(this.root);
  }

  /** Unmarked, with a destructured parameter. */
  open({ name }: { name: string }) {
    return name;
  }

  async items(): Promise<ItemPom[]> {
    return [new ItemPom(this.root)];
  }

  private helper(callback: () => void) {
    callback();
  }

  static create(root: Locator) {
    return new UnmarkedMethodsPom(root);
  }
}

@ayme
export class ItemPom {
  constructor(readonly root: Locator) {}

  select(at: Date) {
    return at;
  }
}
