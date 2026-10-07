import { recordPublishedTools } from "@ayme-dev/ayme/testing";
import { surfaceOf } from "@e2e-dev/web";
import type { App } from "e2e";
import { engine } from "../base.config.ts";

/**
 * Opens the dogfood page and waits for the fixture to report itself ready and
 * the runtime published, the way the Playwright suite's `openFixture` does.
 * The runtime publishes to the recording WebMCP driver from
 * `@ayme-dev/ayme/testing`, installed as a context init script; the engine's
 * context exists only after a first navigation, so the page opens twice. The
 * wait reads `<html>`'s data attributes on the engine's live page; the tests'
 * own assertions go through e2e's `screen`, whose observation walks the
 * Inspector's open shadow root.
 */
export async function openDogfood(app: App): Promise<void> {
  await app.open("/");
  const surface = surfaceOf(engine);
  if (surface === undefined) throw new Error("the web engine has no live page");
  await recordPublishedTools(
    surface.context() as unknown as Parameters<typeof recordPublishedTools>[0]
  );
  await app.open("/dogfood.html");
  await surface
    .page()
    .locator('html[data-fixture="ready"][data-runtime="active"]')
    .waitFor({ state: "attached", timeout: 90_000 });
}

/** The Inspector's expanded panel. */
export const panel = (screen: Screen) =>
  screen.getByRole("complementary", "ayme", { exact: true });

/** The navigator's lens button, pressed while its lens shows. */
export const lensButton = (screen: Screen, name: string) =>
  screen.getByRole("group", "Lens").getByRole("button", name, { exact: true });

type Screen = import("e2e").Screen;
