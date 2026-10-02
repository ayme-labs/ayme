// Serves the spa build configuration, falling back to the client-render
// shell, index.csr.html, for client routes.
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";

const root = path.resolve("dist/spa/browser");
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
    file = path.join(root, "index.csr.html");
  response.writeHead(200, {
    "content-type": types[path.extname(file)] ?? "application/octet-stream",
  });
  createReadStream(file).pipe(response);
}).listen(Number(process.env.PORT ?? 4196), process.env.HOST ?? "127.0.0.1");
