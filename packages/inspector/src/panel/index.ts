export {
  defaultPreferences,
  maxModelSplit,
  minModelSplit,
  type ModelPanes,
} from "./domain/preferences";
export {
  allowPassThrough,
  passThroughWhileCovered,
} from "./infrastructure/panelPassThrough";
export { useHostReservation } from "./infrastructure/useHostReservation";
export { usePreferences } from "./infrastructure/usePreferences";
export { InspectorShell } from "./presentation/InspectorShell";
export { useDarkTheme } from "./presentation/useTheme";
export { DetailPane, InspectorBody, RunsRegion } from "./view/InspectorBody";
export { WebMcpStatus } from "./view/WebMcpStatus";
