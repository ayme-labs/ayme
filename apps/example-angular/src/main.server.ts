import {
  BootstrapContext,
  bootstrapApplication,
} from "@angular/platform-browser";
import { INITIAL_CONFIG } from "@angular/platform-server";
import { App } from "./app/app";
import { config } from "./app/app.config.server";

// Angular SSR gives the server platform the request's URL.
const bootstrap = (context: BootstrapContext) =>
  bootstrapApplication(
    App,
    config(
      new URL(
        context.platformRef.injector.get(INITIAL_CONFIG).url ?? "/",
        "http://localhost"
      )
    ),
    context
  );

export default bootstrap;
