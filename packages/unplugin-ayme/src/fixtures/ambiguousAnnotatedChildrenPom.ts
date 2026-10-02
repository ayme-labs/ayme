import { WebMCP } from "./webmcp";

@WebMCP
class FirstComponent {}

@WebMCP
class SecondComponent {}

@WebMCP
export class AmbiguousAnnotatedChildrenPom {
  readonly ambiguousChild!: FirstComponent & SecondComponent;
}
