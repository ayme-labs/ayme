import { registerCompiledPom } from "@ayme-dev/ayme/internal";

import { startAyme } from "./startAyme";
import { TodoPage, todoPageManifest } from "../pom/TodoPage";

registerCompiledPom(TodoPage, todoPageManifest);
startAyme({ PageObject: TodoPage });
