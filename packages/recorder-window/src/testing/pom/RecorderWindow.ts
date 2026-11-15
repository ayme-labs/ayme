import { Controls } from "./Controls";
import { RecorderPage } from "./parts";
import { Timeline } from "./Timeline";

/** The recorder window: its controls above, the recording below. */
export class RecorderWindow extends RecorderPage {
  readonly controls = new Controls(
    this.page.getByRole("toolbar", { name: "Recorder controls" })
  );
  readonly timeline = new Timeline(this.page.getByRole("main"));

  /** Opens the window at its address, and waits until it shows the
   * recorder's state. */
  async open(url: string): Promise<this> {
    await this.page.goto(url);
    return this.ready();
  }

  /** Reloads the window, and waits until it shows the recorder's state. */
  async reload(): Promise<this> {
    await this.page.reload();
    return this.ready();
  }

  /** Until the first state comes, the window says it is connecting; then a
   * control shows the state, or, once the recorder has ended, the status
   * says how. */
  private async ready(): Promise<this> {
    const { recordButton, stopButton, continueButton, status } = this.controls;
    await recordButton
      .or(stopButton)
      .or(continueButton)
      .or(status.filter({ hasText: /\S/ }).filter({ hasNotText: "Connecting" }))
      .first()
      .waitFor();
    return this;
  }
}
