import { provideClientHydration } from "@angular/platform-browser";

// The spa build configuration replaces this file with hydration.spa.ts.
export const hydration = [provideClientHydration()];
