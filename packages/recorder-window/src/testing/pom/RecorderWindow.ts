import type { Page } from "@playwright/test";

import { Controls } from "./Controls";
import { Timeline } from "./Timeline";

/** The recorder window: its controls above, the recording below. */
export class RecorderWindow {
  readonly controls: Controls;
  readonly timeline: Timeline;

  constructor(readonly page: Page) {
    this.controls = new Controls(
      page.getByRole("toolbar", { name: "Recorder controls" })
    );
    this.timeline = new Timeline(page.getByRole("main"));
  }

  /** Opens the window at its address, and waits until it shows the
   * recorder's state. */
  async open(url: string): Promise<void> {
    await this.page.goto(url);
    await this.ready();
  }

  /** Reloads the window, and waits until it shows the recorder's state. */
  async reload(): Promise<void> {
    await this.page.reload();
    await this.ready();
  }

  /** Until the first state arrives, the window says it is connecting. */
  private async ready() {
    await this.controls.status.filter({ hasNotText: "Connecting" }).waitFor();
  }
}
