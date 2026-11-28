import { ayme } from "@ayme-dev/ayme";
import type { Page } from "@playwright/test";

const onPage = (self: FixturePage) =>
  new URL(self.page.url()).pathname === self.path;

/** A box in the page's coordinates. */
export type Box = { x: number; y: number; width: number; height: number };

/** A page of the fixture app: on the page while the browser is at its path. */
@ayme({ present: onPage })
export abstract class FixturePage {
  abstract readonly path: string;
  constructor(readonly page: Page) {}

  /** Where the recorder draws its highlight on this page: each box, in the
   * page's coordinates. Read in one step, which never waits: the highlight
   * can be cleared at any moment, and a locator's box would wait for it to
   * come back. */
  highlights(): Promise<Box[]> {
    return this.page.evaluate(`[
      ...document.querySelectorAll("ayme-recorder-highlight"),
    ].map((host) => {
      const { x, y, width, height } = host.getBoundingClientRect();
      return { x, y, width, height };
    })`) as Promise<Box[]>;
  }

  /** Has a script of the page call one of the recorder's page functions
   * (`window.__aymeRecorder<name>`) with `value` on every click from now
   * on, as any script of a page can. */
  async callRecorderOnClick(name: string, value: unknown): Promise<void> {
    await this.page.evaluate(`window.recorderAnswered = 0;
      document.addEventListener("click", async () => {
        await window["__aymeRecorder${name}"](${JSON.stringify(value)}).catch(() => {});
        window.recorderAnswered += 1;
      })`);
  }

  /** How many of those calls the recorder has answered. */
  async recorderAnswered(): Promise<number> {
    return (await this.page.evaluate("window.recorderAnswered")) as number;
  }

  /** The one box the recorder's highlight is drawn at on this page; null
   * when it draws none. */
  async highlight(): Promise<Box | null> {
    return (await this.highlights())[0] ?? null;
  }
}
