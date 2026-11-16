import { ayme } from "@ayme-dev/ayme";

import type { Kind } from "@/types/kind";

@ayme
export class KindPicker {
  @ayme.action
  async pick(kind: Kind) {
    void kind;
  }
}
