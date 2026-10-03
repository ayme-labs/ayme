// Renders the app with the candidate's own server renderer (DOM-free Node)
// and writes dist/ssr.html for the browser hydration check.
import fs from "node:fs";
const { render } = await import(
  new URL("./dist-ssr/server.js", import.meta.url)
);
if (typeof window !== "undefined")
  throw new Error("SSR must run without a DOM");
const markup = await render();
console.log(markup);
const page = fs
  .readFileSync("dist/index.html", "utf8")
  .replace(
    '<div id="root"></div>',
    `<div id="root">${markup}</div><script>window.__ssrNode = document.querySelector('section[aria-label="Counter"]')</script>`
  );
if (!page.includes("__ssrNode")) throw new Error("root placeholder not found");
fs.writeFileSync("dist/ssr.html", page);
