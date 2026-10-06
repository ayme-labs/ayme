import type { CSSProperties, ReactNode, Ref } from "react";

import { Divider } from "../../shared";
import type { Layout } from "../domain/preferences";
import type { RegionRange } from "../domain/regions";

/** A divider's range and what dragging, a key or a double-click does. */
export type RegionControl = RegionRange & {
  onChange: (size: number) => void;
  onReset: () => void;
};

/**
 * The panel's body: the navigator beside the detail pane, with Runs below
 * them, or as a third column when the panel is docked to the bottom. A
 * divider on each border between them resizes the navigator and Runs; the
 * one above Runs hides while Runs is collapsed.
 */
export function InspectorBodyView({
  layout,
  navigator,
  detail,
  runs,
  navigatorSize,
  runsSize,
  sizes,
  bodyRef,
}: {
  layout: Layout;
  navigator: ReactNode;
  detail: ReactNode;
  runs: ReactNode;
  navigatorSize: RegionControl;
  runsSize: RegionControl;
  /** The regions' sizes as the CSS variables their own styles read. */
  sizes: CSSProperties;
  bodyRef: Ref<HTMLDivElement>;
}) {
  const runsColumn = layout === "bottom";
  return (
    <div
      ref={bodyRef}
      data-layout={layout}
      className="flex min-h-0 flex-1 flex-col data-[layout=bottom]:flex-row"
      style={sizes}
    >
      <div className="flex min-h-0 min-w-0 flex-1">
        {navigator}
        <Divider
          orientation="vertical"
          border="before"
          label="Resize the navigator"
          step={16}
          {...navigatorSize}
        />
        {detail}
      </div>
      <Divider
        orientation={runsColumn ? "vertical" : "horizontal"}
        border="after"
        label="Resize Runs"
        step={16}
        grows="backward"
        className="[&:has(+[data-collapsed])]:hidden"
        {...runsSize}
      />
      {runs}
    </div>
  );
}

/** The detail pane: the view of what's selected. */
export function DetailPane({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="Selected"
      className="min-h-0 min-w-0 flex-1 overflow-auto px-4 pt-3.5 pb-4"
    >
      {children}
    </section>
  );
}

/** The Runs region. Collapsed, it keeps only the timeline's header. */
export function RunsRegion({
  collapsed = false,
  children,
}: {
  collapsed?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-label="Runs"
      data-collapsed={collapsed || undefined}
      className="flex h-runs min-h-0 flex-none flex-col border-t bg-background data-collapsed:h-region-header in-data-[layout=bottom]:h-auto in-data-[layout=bottom]:w-runs-docked in-data-[layout=bottom]:border-t-0 in-data-[layout=bottom]:border-l in-data-[layout=bottom]:data-collapsed:w-runs-collapsed"
    >
      {children}
    </section>
  );
}
