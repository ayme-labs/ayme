import { ayme } from "@ayme-dev/ayme";

@ayme
export class RenamedDuplicatePom {
  @ayme.action({ description: "Rename a binding." })
  search(query: string, { query: q }: { query: string }) {
    return [query, q];
  }
}
