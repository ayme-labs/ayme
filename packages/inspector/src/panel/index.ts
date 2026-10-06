export {
  defaultPreferences,
  maxModelSplit,
  minModelSplit,
  type ModelPanes,
  type RegionSizes,
} from "./domain/preferences";
export {
  allowPassThrough,
  passThroughWhileCovered,
} from "./infrastructure/panelPassThrough";
export { useHostReservation } from "./infrastructure/useHostReservation";
export { usePreferences } from "./infrastructure/usePreferences";
export { InspectorShell } from "./presentation/InspectorShell";
export { useDarkTheme } from "./presentation/useTheme";
export { InspectorBody } from "./presentation/InspectorBody";
export { DetailPane, RunsRegion } from "./view/InspectorBody";
export { WebMcpStatus } from "./view/WebMcpStatus";
