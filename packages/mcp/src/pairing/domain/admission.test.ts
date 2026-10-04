import { expect, it } from "vitest";

import { admit } from "./admission";

const token = "f00d";

it("pairs a page with the token from any origin", () => {
  for (const origin of [
    "http://localhost:5173",
    "https://example.com",
    undefined,
  ])
    expect(admit({ path: "/f00d", origin, token }), origin).toBe("page");
});

it("pairs and probes without a token only from a page on localhost or 127.0.0.1", () => {
  for (const origin of [
    "http://localhost",
    "http://localhost:5173",
    "https://127.0.0.1:8443",
  ]) {
    expect(admit({ path: "/", origin, token }), origin).toBe("page");
    expect(admit({ path: "/probe", origin, token }), origin).toBe("probe");
  }
});

it("refuses a tokenless connection from any other origin", () => {
  for (const origin of [
    undefined,
    "",
    "null",
    "https://example.com",
    "http://localhost.example.com",
    "http://[::1]:5173",
    "file://localhost",
    "chrome-extension://localhost",
    "http://localhost:5173/path",
  ]) {
    expect(admit({ path: "/", origin, token }), origin).toBe("refused");
    expect(admit({ path: "/probe", origin, token }), origin).toBe("refused");
  }
});

it("refuses a wrong token and any other path", () => {
  const origin = "http://localhost:5173";
  for (const path of ["/f00e", "/f00", "/f00d/", "/other", ""])
    expect(admit({ path, origin, token }), path).toBe("refused");
});
