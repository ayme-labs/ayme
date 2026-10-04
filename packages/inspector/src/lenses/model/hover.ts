import type {
  HighlightTarget,
  OnHover,
} from "../../navigation/domain/highlight";

/**
 * Pointer handlers that show a dashed highlight on the page while a row is
 * hovered. Nothing when the row has nothing on the page to highlight.
 */
export function hoverHandlers(
  onHover: OnHover,
  target: HighlightTarget | undefined
) {
  if (target === undefined) return {};
  return {
    onMouseEnter: () => onHover(target),
    onMouseLeave: () => onHover(undefined),
  };
}
