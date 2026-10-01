import type { ReactNode } from "react";

import type { Layout } from "../shell/preferences";

/**
 * The panel's body: the navigator beside the detail pane, with Runs below
 * them, or as a third column when the panel is docked to the bottom.
 */
export function InspectorBody({
  layout,
  navigator,
  detail,
  runs,
}: {
  layout: Layout;
  navigator: ReactNode;
  detail: ReactNode;
  runs: ReactNode;
}) {
  return (
    <div
      data-layout={layout}
      className="flex min-h-0 flex-1 flex-col data-[layout=bottom]:flex-row"
    >
      <div className="flex min-h-0 min-w-0 flex-1">
        {navigator}
        {detail}
      </div>
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
      className="flex h-[250px] min-h-0 flex-none flex-col border-t bg-background data-collapsed:h-[38px] in-data-[layout=bottom]:h-auto in-data-[layout=bottom]:w-[420px] in-data-[layout=bottom]:border-t-0 in-data-[layout=bottom]:border-l in-data-[layout=bottom]:data-collapsed:w-[150px]"
    >
      {children}
    </section>
  );
}
