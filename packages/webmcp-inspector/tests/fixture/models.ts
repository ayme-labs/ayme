import { registerCompiledPom } from "@ayme-dev/webmcp/internal";

import { startAyme } from "./startAyme";
import { TodoPage, todoPageManifest } from "./TodoPage";

registerCompiledPom(TodoPage, todoPageManifest);
startAyme(TodoPage);
