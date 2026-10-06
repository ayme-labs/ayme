import { aymeTools } from "./ayme-tools.ts";
import { config, engine, POM_FILE } from "./base.config.ts";

/** e2e with the page object actions as replayable tools: the cache records page object calls. */
export default config("ayme", {
  tools: aymeTools({ engine, files: [POM_FILE] }),
});
