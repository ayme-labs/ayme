import type { Connect } from "vite";
import type { Plugin } from "vite";
import { createDecisionEndpoint } from "@ayme-dev/webmcp/server";

import { decisionEndpointPath } from "./decisionEndpointPath";

function readBody(
  request: Connect.IncomingMessage
): Promise<Buffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD")
    return Promise.resolve(undefined);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
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
        const body = await readBody(request);
        const webRequest = new Request(`http://${host}${request.url}`, {
          method: request.method,
          headers: request.headers as HeadersInit,
          body: body ? new Uint8Array(body) : undefined,
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
