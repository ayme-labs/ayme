// Serves the spa build configuration, falling back to the client-render
// shell, index.csr.html, for client routes.
import path from "node:path";
import process from "node:process";
import express from "express";

const root = path.resolve("dist/spa/browser");
express()
  .use(express.static(root, { index: false }))
  .use((_, response) => response.sendFile(path.join(root, "index.csr.html")))
  .listen(Number(process.env.PORT ?? 4196), process.env.HOST ?? "127.0.0.1");
