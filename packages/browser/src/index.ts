export { BrowserError, type BrowserErrorKind } from "./browserError";
export { browserUnavailable, type BrowserRequest } from "./browserRequest";
export { browser, type Browser } from "./infrastructure/live/browser";
export { placeInRange, SUPPORTED_PLAYWRIGHT } from "./playwrightRange";
export {
  projectPlaywright,
  projectPlaywrightCli,
  type Playwright,
  type ProjectPlaywright,
} from "./projectPlaywright";
