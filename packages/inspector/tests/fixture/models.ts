import { registerCompiledPom } from "@ayme-dev/ayme/internal";

import { startAyme } from "./startAyme";
import { TodoPage, todoPageManifest } from "./TodoPage";

registerCompiledPom(TodoPage, todoPageManifest);
startAyme({ PageObject: TodoPage });
