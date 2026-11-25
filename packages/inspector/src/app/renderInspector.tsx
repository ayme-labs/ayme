import type { WindowFullscreen } from "../panel/domain";
import { renderInShadowRoot } from "../shared/infrastructure";
import { InspectorApp } from "./InspectorApp";

/**
 * Renders the Inspector into a shadow root with its compiled stylesheet.
 * React and the stylesheet stay inside the shadow root: nothing is added to
 * the host document's head, and the host's own React, if any, is untouched.
 * `windowed` fills a window of the Inspector's own, which an Agent App may
 * offer `fullscreen`.
 */
export function renderInspector(
  shadowRoot: ShadowRoot,
  {
    windowed = false,
    fullscreen,
  }: { windowed?: boolean; fullscreen?: WindowFullscreen } = {}
) {
  return renderInShadowRoot(
    shadowRoot,
    <InspectorApp windowed={windowed} fullscreen={fullscreen} />
  );
}
