import type {
  LiveAriaSnapshot,
  LiveAriaSnapshotSource,
} from "../capture/LiveAriaSnapshot";
import type { PageId } from "../capture/PageId";

export class MockLiveAriaSnapshotSource implements LiveAriaSnapshotSource {
  private _snapshot: LiveAriaSnapshot = {
    distilledYaml: "",
    undistilledYaml: "",
  };

  async captureAriaSnapshot(_pageId: PageId): Promise<LiveAriaSnapshot> {
    void _pageId;
    return this._snapshot;
  }

  setMockYaml(yaml: string): void {
    this._snapshot = { distilledYaml: yaml, undistilledYaml: yaml };
  }

  setMockSnapshot(snapshot: LiveAriaSnapshot): void {
    this._snapshot = snapshot;
  }
}
