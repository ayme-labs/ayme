import type { PageId } from "./PageId";

export type LiveAriaSnapshot = Readonly<{
  distilledYaml: string;
  undistilledYaml: string;
}>;

export interface LiveAriaSnapshotSource {
  captureAriaSnapshot(
    pageId: PageId,
    options?: { timeout?: number }
  ): Promise<LiveAriaSnapshot>;
}
