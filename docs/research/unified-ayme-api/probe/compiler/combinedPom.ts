// The combined shape: runtime operations on the same import as the markers.
import { ayme } from "@ayme-dev/ayme";

@ayme
export class CombinedPom {
  @ayme.action
  async open() {
    await ayme.getPageState();
  }
}
