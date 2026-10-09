import { ayme } from "@ayme-dev/ayme";

import type { Kind } from "@/types/kind";

@ayme
export class ProjectsPage {
  @ayme.action
  async probe(kind: Kind) {
    void kind;
  }
}
