// The front door, for the CLI: promises and plain data only, so the CLI
// needs neither Effect's nor Playwright's types.
export {
  askSession,
  openSession,
  runSessionProcess,
  type OpenOptions,
  type SessionProcessOptions,
} from "./process/infrastructure";
export type { SessionAnswer, SessionRequest } from "./session/domain";
