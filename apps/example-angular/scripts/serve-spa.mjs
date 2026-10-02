// Serves the production build of the SPA, falling back to index.html for
// client routes. The example needs no server of its own.
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";

const root = path.resolve("dist/example-angular/browser");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".ico": "image/x-icon",
};

createServer((request, response) => {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  let file = path.join(root, decodeURIComponent(pathname));
  if (
    !file.startsWith(root) ||
    !statSync(file, { throwIfNoEntry: false })?.isFile()
  )
    file = path.join(root, "index.html");
  response.writeHead(200, {
    "content-type": types[path.extname(file)] ?? "application/octet-stream",
  });
  createReadStream(file).pipe(response);
}).listen(Number(process.env.PORT ?? 4196), process.env.HOST ?? "127.0.0.1");
