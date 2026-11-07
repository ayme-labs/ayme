const fs = require("fs"),
  zlib = require("zlib");
const [bundle, segsFile] = process.argv.slice(2);
const lines = fs.readFileSync(bundle, "utf8").split("\n");
const segs = JSON.parse(fs.readFileSync(segsFile, "utf8"));
const group = (k) => {
  const pl = /playwright-lite\/dist\/([a-z_]+)/.exec(k);
  if (pl) return "playwright-lite:" + pl[1];
  if (/ayme\/src\/goal-loop/.test(k)) return "ayme:goal-loop";
  if (/lucide-react|node_modules\/shared\//.test(k)) return "lucide-react";
  const m =
    /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/.exec(
      k
    );
  if (m)
    return m[1].startsWith("@radix-ui") ||
      [
        "react-remove-scroll",
        "react-remove-scroll-bar",
        "use-sidecar",
        "use-callback-ref",
        "@floating-ui/core",
        "@floating-ui/dom",
        "@floating-ui/utils",
        "react-style-singleton",
        "aria-hidden",
        "get-nonce",
        "detect-node-es",
      ].includes(m[1])
      ? "radix-ui + helpers"
      : m[1];
  const p = /packages\/([^/]+)\/(src|dist)/.exec(k);
  if (p) return p[1] === "design-system" ? "inspector" : p[1];
  if (/apps\/inject-spike/.test(k)) return "spike Page Objects";
  return "[other/unmapped]";
};
const full = zlib.gzipSync(lines.join("\n"), { level: 9 }).length;
const groups = new Map();
for (const s of segs) {
  const g = group(s[3]);
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(s);
}
const res = [];
for (const [g, list] of groups) {
  const byLine = new Map();
  let bytes = 0;
  for (const [l, a, b] of list) {
    if (!byLine.has(l)) byLine.set(l, []);
    byLine.get(l).push([a, b]);
    bytes += Buffer.byteLength(lines[l].slice(a, b));
  }
  const out = lines.map((t, i) => {
    const r = byLine.get(i);
    if (!r) return t;
    r.sort((x, y) => x[0] - y[0]);
    let o = "",
      pos = 0;
    for (const [a, b] of r) {
      o += t.slice(pos, a);
      pos = b;
    }
    return o + t.slice(pos);
  });
  res.push({
    g,
    bytes,
    gzMarginal: full - zlib.gzipSync(out.join("\n"), { level: 9 }).length,
  });
}
res.sort((a, b) => b.bytes - a.bytes);
console.log("full gzip", full);
for (const r of res)
  console.log(
    `${r.g} | ${(r.bytes / 1024).toFixed(0)} | ${(r.gzMarginal / 1024).toFixed(0)}`
  );
