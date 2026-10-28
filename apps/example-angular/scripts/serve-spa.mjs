// Serves the spa build configuration, falling back to the client-render
// shell, index.csr.html, for client routes.
import path from "node:path";
import process from "node:process";
import express from "express";

const root = path.resolve("dist/spa/browser");
express()
  .use(express.static(root, { index: false }))
  .use((_, response) => response.sendFile("index.csr.html", { root }))
  .listen(
    Number(process.env.PORT ?? 4196),
    process.env.HOST ?? "127.0.0.1",
    function () {
      process.stdout.write(
        `Angular SPA server listening on port ${this.address().port}\n`
      );
    }
  );
