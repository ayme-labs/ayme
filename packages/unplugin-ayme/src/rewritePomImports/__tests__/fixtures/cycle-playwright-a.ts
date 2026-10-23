import { PlaywrightB } from "./cycle-playwright-b";

export class PlaywrightA {
  openB() {
    return new PlaywrightB();
  }
}
