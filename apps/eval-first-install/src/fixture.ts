/**
 * Serves the fixture list app and keeps its list, so the harness reads the
 * outcome from the server instead of from the worker's report.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import { appDir } from "./paths.ts";

export type Item = { id: string; text: string; archived: boolean };
export type ListState = { items: Item[]; nextId: number; rev: number };

const files: Record<string, [string, string]> = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
};

export type Fixture = {
  url: string;
  state: () => ListState;
  log: () => string[];
  close: () => Promise<void>;
};

export async function startFixture(): Promise<Fixture> {
  let state: ListState = {
    items: [
      { id: "item-1", text: "Prepare launch notes", archived: false },
      { id: "item-2", text: "Review onboarding flow", archived: false },
    ],
    nextId: 3,
    rev: 0,
  };
  const log: string[] = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://x").pathname;
    log.push(`${new Date().toISOString()} ${request.method} ${request.url}`);
    if (path === "/api/state" && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(state));
      return;
    }
    if (path === "/api/state" && request.method === "PUT") {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        try {
          const next = JSON.parse(body) as ListState;
          if (Array.isArray(next.items) && next.rev > state.rev) state = next;
          response.writeHead(204).end();
        } catch {
          response.writeHead(400).end();
        }
      });
      return;
    }
    const file = files[path];
    if (file && request.method === "GET") {
      response.writeHead(200, { "content-type": file[1] });
      response.end(readFileSync(join(appDir, file[0])));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve())
  );
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    state: () => state,
    log: () => log,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export type Outcome = {
  passed: boolean;
  checks: Record<string, boolean>;
  active: string[];
  archived: string[];
};

/** The task's end state: Soy milk active, Oat milk and Rye bread not, Rye bread archived. */
export function checkOutcome(state: ListState, n: string): Outcome {
  const active = state.items.filter((i) => !i.archived).map((i) => i.text);
  const archived = state.items.filter((i) => i.archived).map((i) => i.text);
  const checks = {
    [`active has "Soy milk ${n}"`]: active.includes(`Soy milk ${n}`),
    [`active lacks "Oat milk ${n}"`]: !active.includes(`Oat milk ${n}`),
    [`active lacks "Rye bread ${n}"`]: !active.includes(`Rye bread ${n}`),
    [`archived has "Rye bread ${n}"`]: archived.includes(`Rye bread ${n}`),
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    active,
    archived,
  };
}
