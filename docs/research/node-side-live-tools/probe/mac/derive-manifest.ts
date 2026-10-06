// Scratch pilot (not committed). Shows the compiler (unplugin-ayme) deriving
// the Page Object manifests in Node without a bundler, from the decorated
// twin of the pilot's POMs. Run with tsx (the compiler's own imports are
// extensionless, which Node's strip-types does not resolve):
//   node <root>/node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs scratch/node-live/derive-manifest.ts
import { derivePomManifests } from "../../../unplugin-ayme/src/derivePomManifests";

const manifests = derivePomManifests(
  new URL("./AppPage.decorated.ts", import.meta.url).pathname
);
console.log(JSON.stringify(manifests, null, 2));
