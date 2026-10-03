import { ayme } from "@ayme-dev/ayme";
import type { CounterMode } from "./TruncatedMode";

@ayme
export class TruncatedModePage {
  @ayme.action({ description: "Set counter mode metadata." })
  setMode(mode: CounterMode) {
    void mode;
  }
}
