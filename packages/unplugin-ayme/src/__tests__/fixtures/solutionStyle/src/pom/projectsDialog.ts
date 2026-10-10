import { ayme } from "@ayme-dev/ayme";

import { KindPicker } from "./kindPicker";

@ayme
export class ProjectsDialog {
  readonly picker = new KindPicker();
}
