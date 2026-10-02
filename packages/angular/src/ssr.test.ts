// @vitest-environment node
import "@angular/compiler";
import { Component } from "@angular/core";
import {
  bootstrapApplication,
  type BootstrapContext,
} from "@angular/platform-browser";
import {
  provideServerRendering,
  renderApplication,
} from "@angular/platform-server";
import type { RuntimeSession } from "@ayme-dev/ayme";
import { describe, expect, it, vi } from "vitest";

const { sessions } = vi.hoisted(() => ({ sessions: [] as RuntimeSession[] }));
vi.mock("@ayme-dev/ayme", async (importOriginal) => {
  const original = await importOriginal<typeof import("@ayme-dev/ayme")>();
  return {
    ...original,
    createRuntimeSession: (
      ...args: Parameters<typeof original.createRuntimeSession>
    ) => {
      const session = original.createRuntimeSession(...args);
      vi.spyOn(session, "start");
      vi.spyOn(session, "register");
      sessions.push(session);
      return session;
    },
  };
});
import {
  injectAyme,
  injectPageObject,
  provideAyme,
  type AymeOptions,
} from "./index";

type PageFactory = NonNullable<AymeOptions["pageFactory"]>;

describe.each([false, true])(
  "server rendering with webMCP.enabled=%s",
  (enabled) => {
    it("renders concurrent requests without starting Ayme, calling the page factory, or constructing or registering Page Objects", async () => {
      sessions.length = 0;
      const pageFactory = vi.fn<PageFactory>(() => {
        throw new Error("The page factory must not run on the server.");
      });
      let constructions = 0;
      class ServerModel {
        constructor() {
          constructions += 1;
          throw new Error(
            "Page Objects must not be constructed on the server."
          );
        }
        increment() {
          throw new Error("Page Object actions are browser-only.");
        }
      }
      const models: ServerModel[] = [];
      // SSR must not require compiler-derived browser metadata.
      const Root = Component({
        selector: "app-root",
        template: `<button (click)="model.increment()">{{ webMCP.publicationStatus().state }}</button>`,
      })(
        class {
          readonly model = injectPageObject(ServerModel);
          readonly webMCP = injectAyme().webMCP;
          constructor() {
            models.push(this.model);
          }
        }
      );
      const render = () =>
        renderApplication(
          (context: BootstrapContext) =>
            bootstrapApplication(
              Root,
              {
                providers: [
                  provideServerRendering(),
                  provideAyme({ pageFactory, webMCP: { enabled } }),
                ],
              },
              context
            ),
          { document: "<app-root></app-root>", url: "/" }
        );

      const pages = await Promise.all([render(), render()]);

      const status = enabled ? "waiting" : "disabled";
      for (const html of pages) expect(html).toContain(`>${status}</button>`);
      expect(sessions).toHaveLength(2);
      for (const session of sessions) {
        expect(session.start).not.toHaveBeenCalled();
        expect(session.register).not.toHaveBeenCalled();
        expect(session.webMCP.publicationStatus.state).toBe(status);
      }
      expect(pageFactory).not.toHaveBeenCalled();
      expect(constructions).toBe(0);
      expect(models).toHaveLength(2);
      for (const model of models) expect(model).toBeInstanceOf(ServerModel);
    });
  }
);
