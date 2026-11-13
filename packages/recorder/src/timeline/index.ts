export type {
  InteractionReport,
  PageSnapshot,
  RecordedInteraction,
  TimelineAddition,
  VisitCause,
} from "./domain/recorded";
export { Timeline, type PackageHeader } from "./domain/timeline";
export { saveRecording } from "./infrastructure/recordingStore";
