import { Inspector } from "#pom/Inspector";
import { startListApp } from "./listApp";

// Dogfooding: the list app with the Inspector in an open shadow root, the
// Agent Connection on, and the Inspector's own Page Object registered beside
// ListPage. tsconfig.json names the Page Object's source as a file of this
// project, so the plugin compiles it like the fixture's own.
startListApp({ dogfood: true, alsoRegister: [Inspector] });
