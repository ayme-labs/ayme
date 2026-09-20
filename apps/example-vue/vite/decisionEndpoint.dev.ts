import type { Connect } from "vite";
import type { Plugin } from "vite";
import { createDecisionEndpoint } from "@ayme-dev/webmcp/server";

import { decisionEndpointPath } from "./decisionEndpointPath";

const maxBodyBytes = 1024 * 1024;

type BodyReadResult =
  { body: Uint8Array | undefined; tooLarge: false } | { tooLarge: true };

function readBody(request: Connect.IncomingMessage): Promise<BodyReadResult> {
  if (request.method === "GET" || request.method === "HEAD")
    return Promise.resolve({ body: undefined, tooLarge: false });

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let byteLength = 0;
    let tooLarge = false;
    request.on("data", (chunk: Buffer) => {
      if (tooLarge) return;
      byteLength += chunk.byteLength;
      if (byteLength > maxBodyBytes) {
        tooLarge = true;
        chunks.length = 0;
        resolve({ tooLarge: true });
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!tooLarge) resolve({ body: Buffer.concat(chunks), tooLarge: false });
    });
    request.on("error", reject);
  });
}

export function decisionEndpointDev(apiKey?: string): Plugin {
  return {
    name: "example-vue-decision-endpoint-dev",
    apply: "serve",
    configureServer(server) {
      if (!apiKey) return;

      const handler = createDecisionEndpoint({
        apiKey,
        authorize() {},
      });

      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split("?", 1)[0];
        if (pathname !== decisionEndpointPath) {
          next();
          return;
        }

        const host = request.headers.host ?? "127.0.0.1:4190";
        const bodyResult = await readBody(request);
        if (bodyResult.tooLarge) {
          response.statusCode = 413;
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({ error: "The request body must be at most 1 MB." })
          );
          return;
        }
        const webRequest = new Request(`http://${host}${request.url}`, {
          method: request.method,
          headers: request.headers as HeadersInit,
          body: bodyResult.body ? Uint8Array.from(bodyResult.body) : undefined,
        });
        const webResponse = await handler(webRequest);
        response.statusCode = webResponse.status;
        webResponse.headers.forEach((value, key) => {
          response.setHeader(key, value);
        });
        response.end(Buffer.from(await webResponse.arrayBuffer()));
      });
    },
  };
}
