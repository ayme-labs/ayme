import { ayme } from "@ayme-dev/ayme";

import { KindPicker } from "./kindPicker";

@ayme
export class ProjectsDialog {
  @ayme.child
  readonly picker = new KindPicker();
}
