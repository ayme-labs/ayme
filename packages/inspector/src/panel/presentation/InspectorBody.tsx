import type { CSSProperties, ReactNode } from "react";

import type { Layout, RegionSizes } from "../domain/preferences";
import { regionRanges } from "../domain/regions";
import { InspectorBodyView } from "../view/InspectorBody";
import { useBodyMeasure } from "./useBodyMeasure";

/**
 * The panel's body, with the navigator and Runs at the sizes the person
 * dragged them to, fitted to the room the body has. An unset size keeps
 * the layout's own.
 */
export function InspectorBody({
  layout,
  navigator,
  detail,
  runs,
  regions,
  onRegionsChange,
}: {
  layout: Layout;
  navigator: ReactNode;
  detail: ReactNode;
  runs: ReactNode;
  regions: RegionSizes;
  onRegionsChange: (regions: RegionSizes) => void;
}) {
  const [body, measure] = useBodyMeasure(layout);
  const ranges = regionRanges(regions, measure, layout);
  const runsKey = layout === "bottom" ? "runsWidth" : "runsHeight";
  const change = (patch: RegionSizes) =>
    onRegionsChange({ ...regions, ...patch });

  // The regions' own styles size them from these theme variables.
  const sizes: Record<string, string> = {};
  if (regions.navigatorWidth !== undefined) {
    const width = `${ranges.navigator.value}px`;
    sizes["--spacing-navigator"] = width;
    sizes["--spacing-navigator-narrow"] = width;
    sizes["--spacing-navigator-docked"] = width;
  }
  if (regions[runsKey] !== undefined)
    sizes[layout === "bottom" ? "--spacing-runs-docked" : "--spacing-runs"] =
      `${ranges.runs.value}px`;

  return (
    <InspectorBodyView
      layout={layout}
      navigator={navigator}
      detail={detail}
      runs={runs}
      bodyRef={body}
      sizes={sizes as CSSProperties}
      navigatorSize={{
        ...ranges.navigator,
        onChange: (width) => change({ navigatorWidth: width }),
        onReset: () => change({ navigatorWidth: undefined }),
      }}
      runsSize={{
        ...ranges.runs,
        onChange: (size) => change({ [runsKey]: size }),
        onReset: () => change({ [runsKey]: undefined }),
      }}
    />
  );
}
