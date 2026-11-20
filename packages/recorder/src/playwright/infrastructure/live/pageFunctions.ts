import {
  drawHighlight,
  followPicking,
  outline,
  startPicking,
  type HighlightBox,
  type PickingStart,
} from "../in-page/drawing";
import { pickWithGate } from "../in-page/calls";
import { gateIn } from "../in-page/gate";
import {
  actedOn,
  ancestorRefsIn,
  ariaRefOf,
  elementAbove,
  targetWatchIn,
} from "../in-page/watches";
import {
  actedOnIndex,
  ancestorChain,
  clickHeld,
  controlsSelector,
  gateStartsOn,
  keyHeld,
  keyRoute,
  keyTarget,
  leftAlone,
  modifiersOf,
  mouseRoute,
  recordersOwn,
  recordedAsPress,
  replayed,
  replayedEffect,
  arrivingEvent,
  heldButton,
  typingKey,
  withRules,
} from "../pageRules";

// The page functions that decide by rules, joined with those rules as the
// adapter sends them into a page: here, where the page code and the plain
// rules meet, since neither may reach the other's folder.

/** Installs the gate in a document: `gateIn` with the gate's rules. */
export const installGate: (held: string) => void = withRules(
  gateIn,
  {
    recordedAsPress,
    keyTarget,
    clickHeld,
    modifiersOf,
    replayed,
    replayedEffect,
    arrivingEvent,
    heldButton,
    gateStartsOn,
    mouseRoute,
    keyRoute,
    keyHeld,
  },
  [leftAlone, typingKey]
);

const ancestorRules = { ancestorChain, elementAbove, ariaRefOf };

/** Installs the target watch in a document. */
export const installTargetWatch: (tell: string) => void = withRules(
  targetWatchIn,
  { ...ancestorRules, actedOnIndex, controlsSelector, actedOn }
);

/** Reads the refs of an element's ancestors in its page. */
export const ancestorRefs: (element: Element) => (string | null)[] = withRules(
  ancestorRefsIn,
  ancestorRules
);

/** Draws the recorder's highlight in a page: `drawHighlight` with the
 * outline it shares with picking. */
export const highlightIn: (boxes: readonly HighlightBox[] | null) => void =
  withRules(drawHighlight, { outline });

/** Outlines the element under the mouse in a document while Playwright
 * picks, or no longer. */
export const followPickingIn: (on: boolean) => void = withRules(followPicking, {
  outline,
  recordersOwn,
});

/** Starts a document that loads while Playwright picks with the outline
 * following the mouse and its gate leaving the picking click to Playwright,
 * or with neither, as the latest start said. */
export const startPickingIn: (start: PickingStart) => void = withRules(
  startPicking,
  { outline, recordersOwn, followPicking, pickWithGate }
);
