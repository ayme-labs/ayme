// node aggregate.mjs <dir>: aggregates npm per-version last-week downloads by stable major.
import fs from "node:fs";
const dir = process.argv[2];
const stable = /^\d+\.\d+\.\d+$/;
const rows = [];
for (const p of ["react", "vue", "next", "nuxt"]) {
  const { downloads } = JSON.parse(
    fs.readFileSync(`${dir}/versions-${p}.json`, "utf8")
  );
  const point = JSON.parse(fs.readFileSync(`${dir}/point-${p}.json`, "utf8"));
  let total = 0,
    stableTotal = 0,
    pre = 0,
    preCount = 0;
  const byMajor = {};
  for (const [v, n] of Object.entries(downloads)) {
    total += n;
    if (!stable.test(v)) {
      pre += n;
      preCount++;
      continue;
    }
    stableTotal += n;
    let [maj, min] = v.split(".").map(Number);
    let key = String(maj);
    if (p === "react" && maj === 16)
      key = min >= 8 ? "16 (>=16.8)" : "16 (<16.8)";
    if (p === "next" && maj === 15)
      key = min >= 5 ? "15 (>=15.5)" : "15 (<15.5)";
    if (p === "nuxt" && maj === 3) key = min >= 17 ? "3 (>=3.17)" : "3 (<3.17)";
    if (p === "nuxt" && maj === 4 && v === "4.0.0") key = "4 (=4.0.0)";
    byMajor[key] = (byMajor[key] ?? 0) + n;
  }
  console.log(
    `\n## ${p}: per-version sum ${total}, point endpoint ${point.downloads} (${point.start}..${point.end}), stable ${stableTotal}, excluded non-stable ${pre} across ${preCount} versions`
  );
  for (const [k, n] of Object.entries(byMajor)
    .sort((a, b) => b[1] - a[1])
    .filter(([, n]) => n / stableTotal >= 0.001))
    console.log(`${k}\t${n}\t${((100 * n) / stableTotal).toFixed(2)}%`);
}
