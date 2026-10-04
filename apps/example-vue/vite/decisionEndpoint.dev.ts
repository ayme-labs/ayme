import { Readable } from "node:stream";

import type { Plugin } from "vite";
import {
  createDecisionEndpoint,
  type CreateDecisionEndpointOptions,
} from "@ayme-dev/ayme/server";

import { decisionEndpointPath } from "./decisionEndpointPath";

export function decisionEndpointDev(
  upstream?: Pick<CreateDecisionEndpointOptions, "provider" | "apiKey">
): Plugin {
  return {
    name: "example-vue-decision-endpoint-dev",
    apply: "serve",
    configureServer(server) {
      if (!upstream) return;

      const handler = createDecisionEndpoint({
        ...upstream,
        authorize() {},
      });

      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split("?", 1)[0];
        if (pathname !== decisionEndpointPath) {
          next();
          return;
        }

        const host = request.headers.host ?? "127.0.0.1:4190";
        const canHaveBody =
          request.method !== "GET" && request.method !== "HEAD";
        const webRequest = new Request(`http://${host}${request.url}`, {
          method: request.method,
          headers: request.headers as HeadersInit,
          ...(canHaveBody && {
            body: Readable.toWeb(request),
            duplex: "half",
          }),
        } as RequestInit);
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
