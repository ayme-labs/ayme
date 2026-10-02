import { ApplicationConfig } from "@angular/core";
import { provideRouter } from "@angular/router";
import { provideClientHydration } from "@angular/platform-browser";
import { routes } from "./app.routes";
import { provideAyme } from "../ayme-angular";

export const appConfig: ApplicationConfig = {
  providers: [provideRouter(routes), provideClientHydration(), provideAyme()],
};
