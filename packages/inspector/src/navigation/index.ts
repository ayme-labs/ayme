export {
  type HighlightTarget,
  type OnHover,
  selectionHighlight,
} from "./domain/highlight";
export type { Lens, LensId, SearchEntry } from "./domain/lens";
export type { RenderRun } from "./domain/runSlot";
export { pageSelection, type Selection } from "./domain/selection";
export { useHighlights } from "./infrastructure/useHighlights";
export { Navigator } from "./presentation/Navigator";
export { NavItem } from "./view/NavItem";
