import { Inspector } from "../pom/Inspector";
import { startListApp } from "./listApp";

// Dogfooding: the list app with the Inspector in an open shadow root, the
// Agent Connection on, and the Inspector's own Page Object registered beside
// ListPage. The Vite config resolves the testing entry to the Inspector's
// source, so the plugin compiles the Page Object like the fixture's own.
startListApp({ dogfood: true, alsoRegister: [Inspector] });
