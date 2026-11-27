import { Inspector } from "#pom/Inspector";
import { startListApp } from "./listApp";

// Dogfooding: the list app with the Inspector in an open shadow root and the
// Inspector's own Page Object registered beside ListPage. ayme/pom/Inspector.ts
// imports the Page Object's source by a relative path, so the plugin compiles
// it like the fixture's own.
startListApp({ dogfood: true, alsoRegister: [Inspector] });
