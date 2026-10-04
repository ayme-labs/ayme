import {
  ApplicationConfig,
  isDevMode,
  provideBrowserGlobalErrorListeners,
} from "@angular/core";
import { provideRouter } from "@angular/router";
import { provideAyme } from "@ayme-dev/angular";
import { routes } from "./app.routes";
import { hydration } from "./hydration";

/**
 * The application config for one page load. The E2E suite varies Ayme's
 * publication through the page URL: `?publication=off` leaves it off, as
 * without `webMCP.enabled`, and `?toolNamePrefix=<prefix>` prefixes the
 * published tool names. The server and the browser read the same URL, so
 * their first render agrees.
 */
export function appConfig(url: URL): ApplicationConfig {
  const query = url.searchParams;
  return {
    providers: [
      provideBrowserGlobalErrorListeners(),
      provideRouter(routes),
      hydration,
      provideAyme({
        inspector: isDevMode(),
        ...(query.get("publication") === "off"
          ? {}
          : {
              webMCP: {
                enabled: true,
                toolNamePrefix: query.get("toolNamePrefix") ?? undefined,
              },
            }),
      }),
    ],
  };
}
