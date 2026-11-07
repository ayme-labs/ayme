const fs = require("fs"),
  zlib = require("zlib");
const [bundle, segsFile] = process.argv.slice(2);
const lines = fs.readFileSync(bundle, "utf8").split("\n");
const segs = JSON.parse(fs.readFileSync(segsFile, "utf8"));
const UI =
  /packages\/(inspector|design-system)\/|lucide-react|node_modules\/shared\/|react-dom|\/react\/|scheduler|@radix-ui|react-remove-scroll|use-sidecar|use-callback-ref|@floating-ui|react-style-singleton|aria-hidden|get-nonce|detect-node-es|tailwind-merge|sugar-high|class-variance-authority|clsx/;
const SNAP = /playwright-lite\/dist\/(snapdom|_virtual)/;
const sets = {
  "Inspector UI": (k) => UI.test(k),
  "snapdom+mime": (k) => SNAP.test(k),
  "Inspector UI + snapdom + mime": (k) => UI.test(k) || SNAP.test(k),
};
const total = Buffer.byteLength(lines.join("\n")),
  gz = zlib.gzipSync(lines.join("\n"), { level: 9 }).length;
console.log(`full | ${(total / 1024).toFixed(0)} | ${(gz / 1024).toFixed(0)}`);
for (const [name, pred] of Object.entries(sets)) {
  const byLine = new Map();
  for (const [l, a, b, k] of segs)
    if (pred(k)) {
      if (!byLine.has(l)) byLine.set(l, []);
      byLine.get(l).push([a, b]);
    }
  const out = lines
    .map((t, i) => {
      const r = byLine.get(i);
      if (!r) return t;
      r.sort((x, y) => x[0] - y[0]);
      let o = "",
        p = 0;
      for (const [a, b] of r) {
        o += t.slice(p, a);
        p = b;
      }
      return o + t.slice(p);
    })
    .join("\n");
  console.log(
    `without ${name} | ${(Buffer.byteLength(out) / 1024).toFixed(0)} | ${(zlib.gzipSync(out, { level: 9 }).length / 1024).toFixed(0)}`
  );
}
