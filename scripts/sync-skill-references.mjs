/**
 * Writes every skill's copies of shared references and guide pages, as
 * `scripts/check-docs.mjs` defines them; that check fails when a copy differs.
 *
 *   node scripts/sync-skill-references.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { skillReferenceCopies, skillReferenceText } from "./check-docs.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const { source, copy } of skillReferenceCopies(root)) {
  if (!fs.existsSync(path.join(root, source))) continue;
  fs.mkdirSync(path.dirname(path.join(root, copy)), { recursive: true });
  fs.writeFileSync(path.join(root, copy), skillReferenceText(root, source));
  console.log(`${source} -> ${copy}`);
}
