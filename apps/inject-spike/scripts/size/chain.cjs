// Attribute every byte of a bundle to an original source, following
// sourceMappingURL chains through the workspace packages' dist files.
const fs = require("fs"),
  path = require("path"),
  zlib = require("zlib");
const { SourceMapConsumer } = require("source-map");
const [bundle] = process.argv.slice(2);
const cache = new Map();
async function consumerFor(file) {
  if (cache.has(file)) return cache.get(file);
  let c = null;
  const mapFile = file + ".map";
  if (fs.existsSync(mapFile))
    c = await new SourceMapConsumer(
      JSON.parse(fs.readFileSync(mapFile, "utf8"))
    );
  cache.set(file, c);
  return c;
}
async function resolve(file, line, column, depth = 0) {
  const c = depth < 6 ? await consumerFor(file) : null;
  if (!c) return file;
  const o = c.originalPositionFor({
    line,
    column,
    bias: SourceMapConsumer.GREATEST_LOWER_BOUND,
  });
  if (!o.source) return file + " [unmapped]";
  const src = path.resolve(path.dirname(file), o.source);
  return resolve(src, o.line, o.column, depth + 1);
}
(async () => {
  const code = fs.readFileSync(bundle, "utf8");
  const lines = code.split("\n");
  const top = await consumerFor(bundle);
  const segs = [];
  top.eachMapping((m) => segs.push(m), null, SourceMapConsumer.GENERATED_ORDER);
  const bytes = new Map(),
    text = new Map();
  const add = (k, s) => {
    bytes.set(k, (bytes.get(k) ?? 0) + Buffer.byteLength(s));
    text.set(k, (text.get(k) ?? "") + s);
  };
  let covered = 0;
  const segsOut = [];
  for (let i = 0; i < segs.length; i++) {
    const m = segs[i],
      n = segs[i + 1];
    const lineText = lines[m.generatedLine - 1];
    const end =
      n && n.generatedLine === m.generatedLine
        ? n.generatedColumn
        : lineText.length;
    const s = lineText.slice(m.generatedColumn, end);
    const k = m.source
      ? await resolve(
          path.resolve(path.dirname(bundle), m.source),
          m.originalLine,
          m.originalColumn
        )
      : "[unmapped]";
    segsOut.push([m.generatedLine - 1, m.generatedColumn, end, k]);
    add(k, s);
    covered += Buffer.byteLength(s);
  }
  const out = [...bytes].map(([k, b]) => ({
    k,
    b,
    gz: zlib.gzipSync(text.get(k), { level: 9 }).length,
  }));
  if (process.argv[3]) {
    fs.writeFileSync(process.argv[3], JSON.stringify(segsOut));
  }
  console.log(
    JSON.stringify({
      total: Buffer.byteLength(code),
      covered,
      totalGz: zlib.gzipSync(code, { level: 9 }).length,
      files: out,
    })
  );
})();
