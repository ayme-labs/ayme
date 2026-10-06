// Serves the pilot dir and the playwright-lite fork's dist through page.route, so the fixture and the
// fork's ES module build share one http origin (module scripts need one; file:// does not give it).
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";

export const ORIGIN = "http://pilot.local";
const types: Record<string, string> = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json" };

export async function serve(page: Page, mounts: Record<string, string>) {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const [, mount, ...rest] = url.pathname.split("/");
    const dir = mounts[mount!];
    if (!dir) return route.fulfill({ status: 404, body: "no mount " + mount });
    const file = path.join(dir, ...rest);
    try {
      const body = await readFile(file);
      return route.fulfill({ status: 200, body, contentType: types[path.extname(file)] ?? "application/octet-stream", headers: { "access-control-allow-origin": "*" } });
    } catch {
      return route.fulfill({ status: 404, body: "not found " + file });
    }
  });
}
