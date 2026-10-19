import { createAyme } from "@ayme-dev/ayme";
import { ListPage } from "./ListPage";

// An app that uses Ayme as a framework integration would: a session with
// publication on, started, and a Page Object registered with it.
export const ayme = createAyme({ webMCP: { enabled: true }, inspector: true });
export const stop = ayme.start();
export const page = ayme.pom.register(ListPage);
