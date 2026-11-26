// The front door, for the CLI: promises and plain data only, so the CLI
// needs neither Effect's nor Playwright's types.
export {
  askSession,
  listSessions,
  openSession,
  runSessionProcess,
  type SessionPlace,
} from "./process/infrastructure";
export type { SessionAnswer, SessionRequest } from "./session/domain";
