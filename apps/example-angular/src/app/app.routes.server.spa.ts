import { RenderMode, ServerRoute } from "@angular/ssr";

// Replaces app.routes.server.ts in the spa build configuration.
export const serverRoutes: ServerRoute[] = [
  { path: "**", renderMode: RenderMode.Client },
];
