// The front door, for the CLI: promises and plain data only, so the CLI
// needs neither Effect's nor Playwright's types.
export {
  agentAppPage,
  askCall,
  askSession,
  inspectSession,
  listSessions,
  openSession,
  runSessionProcess,
} from "./process/infrastructure";
export type { AgentAppPage } from "./process/infrastructure";
export type { SessionAnswer, SessionRequest } from "./session/domain";
