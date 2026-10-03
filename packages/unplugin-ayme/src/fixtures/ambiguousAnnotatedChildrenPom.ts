import { ayme } from "@ayme-dev/ayme";

@ayme
class FirstComponent {}

@ayme
class SecondComponent {}

@ayme
export class AmbiguousAnnotatedChildrenPom {
  readonly ambiguousChild!: FirstComponent & SecondComponent;
}
