import { WebMCP } from "@ayme-dev/webmcp";
import type { CounterMode } from "./TruncatedMode";

@WebMCP
export class TruncatedModePage {
  @WebMCP.tool({ description: "Set counter mode metadata." })
  setMode(mode: CounterMode) {
    void mode;
  }
}
