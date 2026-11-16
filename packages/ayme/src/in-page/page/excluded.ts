// Stryker disable all
// The excluded-subtree mark in the document (`shared`): whether any subtree
// carries it, whether one covers an element where a pointer action would land,
// and the hit-test mark Demo Mode's pass-through sets on the roots of them.
import {
  EXCLUDED_SUBTREE_SELECTOR,
  HIT_TEST_THROUGH_ATTRIBUTE,
} from "../../shared";

/** Whether the document holds a subtree that carries the mark. */
export function hasExcludedSubtree(): boolean {
  return document.querySelector(EXCLUDED_SUBTREE_SELECTOR) !== null;
}

/** Sets or clears the hit-test mark on the root of every excluded subtree. */
export function passThroughExcluded(on: boolean): void {
  for (const root of document.querySelectorAll(EXCLUDED_SUBTREE_SELECTOR))
    root.toggleAttribute(HIT_TEST_THROUGH_ATTRIBUTE, on);
}

/**
 * Whether an excluded subtree is what the pointer meets at the action point
 * of one of `elements`: the centre of its first client rect inside the
 * viewport, as Playwright Lite picks it. An element of an excluded subtree
 * itself is never under one: a page that dogfoods a panel drives it through
 * these actions.
 */
export function coveredByExcluded(elements: readonly Element[]): boolean {
  return elements.some((element) => {
    const rootNode = element.getRootNode() as Partial<ShadowRoot>;
    if (rootNode.host?.matches(EXCLUDED_SUBTREE_SELECTOR)) return false;
    const document = element.ownerDocument;
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    for (const rect of element.getClientRects()) {
      const left = Math.max(0, rect.left);
      const right = Math.min(width, rect.right);
      const top = Math.max(0, rect.top);
      const bottom = Math.min(height, rect.bottom);
      if (right <= left || bottom <= top) continue;
      if ((right - left) * (bottom - top) <= 0.99) continue;
      const hit = document.elementFromPoint(
        (left + right) / 2,
        (top + bottom) / 2
      );
      return hit?.matches(EXCLUDED_SUBTREE_SELECTOR) ?? false;
    }
    return false;
  });
}
