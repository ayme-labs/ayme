import { PlaywrightA } from "./cycle-playwright-a";
import { tainted } from "./playwright-runtime";

export class PlaywrightB {
  openA() {
    return new PlaywrightA();
  }

  browser() {
    return tainted;
  }
}
