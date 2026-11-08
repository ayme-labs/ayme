import { ayme } from "@ayme-dev/ayme";

type Options = { limit: number; order: "asc" | "desc" };

@ayme
export class TypeDuplicatePom {
  @ayme.action({ description: "Take a field from the type." })
  search(limit: number, { order }: Options) {
    return [limit, order];
  }
}
