import { chromium } from "playwright";

import { PlaywrightA } from "./cycle-playwright-a";

export class PlaywrightB {
  openA() {
    return new PlaywrightA();
  }

  browser() {
    return chromium;
  }
}
