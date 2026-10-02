import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from "@angular/core";
import { provideRouter } from "@angular/router";
import { provideAyme } from "@ayme-dev/angular";
import { routes } from "./app.routes";
import { hydration } from "./hydration";

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    hydration,
    provideAyme({ webMCP: { enabled: true } }),
  ],
};
