import {
  drawHighlight,
  followPicking,
  outline,
  type HighlightBox,
} from "../in-page/drawing";
import { gateIn } from "../in-page/gate";
import {
  ancestorRefsIn,
  ariaRefOf,
  elementAbove,
  targetWatchIn,
} from "../in-page/watches";
import {
  ancestorChain,
  clickHeld,
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
  ancestorRules
);

/** Reads the refs of an element's ancestors in its page. */
export const ancestorRefs: (element: Element) => (string | null)[] = withRules(
  ancestorRefsIn,
  ancestorRules
);

/** Draws the recorder's highlight in a page: `drawHighlight` with the
 * outline it shares with picking. */
export const highlightIn: (box: HighlightBox | null) => void = withRules(
  drawHighlight,
  { outline }
);

/** Outlines the element under the mouse in a document while Playwright
 * picks, or no longer. */
export const followPickingIn: (on: boolean) => void = withRules(followPicking, {
  outline,
  recordersOwn,
});
