import { expect, it } from "vitest";

import { BUSY_SERVER, SERVER_IDENTITY, admit } from "./admission";

const token = "f00d";

it("pairs a page with the token from any origin", () => {
  for (const origin of [
    "http://localhost:5173",
    "https://example.com",
    undefined,
  ])
    expect(admit({ path: "/f00d", origin, token }), origin).toBe("token");
});

it("pairs and probes without a token only from a page on localhost or 127.0.0.1", () => {
  for (const origin of [
    "http://localhost",
    "http://localhost:5173",
    "https://127.0.0.1:8443",
  ]) {
    expect(admit({ path: "/", origin, token }), origin).toBe("tokenless");
    expect(admit({ path: "/probe", origin, token }), origin).toBe("probe");
  }
});

it("refuses a tokenless connection from any other origin, or an empty one", () => {
  for (const origin of [
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

it("pairs and probes a local process, which sends no Origin, without a token", () => {
  expect(admit({ path: "/", origin: undefined, token })).toBe("tokenless");
  expect(admit({ path: "/probe", origin: undefined, token })).toBe("probe");
});

it("tells a local process that its token is not this server's", () => {
  expect(admit({ path: "/f00e", origin: undefined, token })).toBe(
    "unknownPairing"
  );
});

it("tells a page on localhost that its token is not this server's", () => {
  for (const path of ["/f00e", "/f00", "/other"])
    expect(admit({ path, origin: "http://localhost:5173", token }), path).toBe(
      "unknownPairing"
    );
});

it("refuses a wrong token from any other origin, and any other path", () => {
  expect(admit({ path: "/f00e", origin: "https://example.com", token })).toBe(
    "refused"
  );
  const origin = "http://localhost:5173";
  for (const path of ["/f00d/", "/a/b", ""])
    expect(admit({ path, origin, token }), path).toBe("refused");
});

// Pages and servers of different Ayme versions read these close frames.
it("closes a probe with the codes and reasons older pages know", () => {
  expect(SERVER_IDENTITY).toEqual({ code: 4350, reason: "ayme-mcp" });
  expect(BUSY_SERVER).toEqual({ code: 4351, reason: "ayme-mcp-busy" });
});
