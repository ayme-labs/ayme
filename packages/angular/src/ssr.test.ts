// @vitest-environment node
// Angular 19 needs Zone.js by default; later majors render zoneless with it
// loaded too.
import "zone.js/node";
import "@angular/compiler";
import { Component, type ApplicationRef } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import {
  provideServerRendering,
  renderApplication,
} from "@angular/platform-server";
import type { Ayme } from "@ayme-dev/ayme";
import { listRegisteredPoms } from "@ayme-dev/ayme/internal";
import { describe, expect, it, vi } from "vitest";

const { sessions } = vi.hoisted(() => ({ sessions: [] as Ayme[] }));
vi.mock("@ayme-dev/ayme", async (importOriginal) => {
  const original = await importOriginal<typeof import("@ayme-dev/ayme")>();
  return {
    ...original,
    createAyme: (...args: Parameters<typeof original.createAyme>) => {
      const session = original.createAyme(...args);
      vi.spyOn(session, "start");
      vi.spyOn(session, "peek");
      sessions.push(session);
      return session;
    },
  };
});
import {
  injectAyme,
  injectPageObject,
  injectPeek,
  provideAyme,
  type AymeOptions,
} from "./index";

type PageFactory = NonNullable<AymeOptions["pageFactory"]>;
// Angular 20 passes the server's BootstrapContext on to bootstrapApplication;
// Angular 19 calls the bootstrap function without one.
const bootstrap = bootstrapApplication as (
  ...args: unknown[]
) => Promise<ApplicationRef>;

describe.each([false, true])(
  "server rendering with webMCP.enabled=%s",
  (enabled) => {
    it("renders concurrent requests without starting Ayme, calling the page factory, constructing or registering Page Objects, or adding Peeks", async () => {
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
            injectPeek({ count: 0 }, "counter");
            models.push(this.model);
          }
        }
      );
      const render = () =>
        renderApplication(
          (context?: unknown) =>
            bootstrap(
              Root,
              {
                providers: [
                  provideServerRendering(),
                  // agentConnection on, so ayme.peek would add the instance.
                  provideAyme({
                    pageFactory,
                    webMCP: { enabled },
                    agentConnection: true,
                  }),
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
        expect(session.peek).not.toHaveBeenCalled();
        expect(session.webMCP.publicationStatus.state).toBe(status);
      }
      expect(listRegisteredPoms()).toHaveLength(0);
      expect(pageFactory).not.toHaveBeenCalled();
      expect(constructions).toBe(0);
      expect(models).toHaveLength(2);
      for (const model of models) expect(model).toBeInstanceOf(ServerModel);
    });
  }
);
