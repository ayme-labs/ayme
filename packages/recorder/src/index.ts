// The engine's front door. Promises, callbacks and plain data only: no Effect
// type and no Playwright type is reachable from here (src/frontDoor.test.ts).
export type {
  CommandResult,
  InteractionDetails,
  RecordedVisit,
  RecorderCommand,
  RecorderPhase,
  RecorderState,
  RecorderUpdate,
  RecorderWarning,
  RecordingOutcome,
  TimelineEntry,
} from "./contract";
export {
  runInstall,
  runTrace,
  startRecorder,
  type Recorder,
  type RecorderOptions,
} from "./engine";
export { RecorderStartError, type RecorderStartReason } from "./session/domain";
