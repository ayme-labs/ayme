import { ayme } from "@ayme-dev/ayme";

type Credentials = { email: string; password: string; remember?: boolean };

type SearchOptions = { limit?: number; order: "asc" | "desc" };

const lastName = "last";

@ayme
export class DestructuredParametersPom {
  @ayme.action({ description: "Sign in." })
  signIn({ email, password }: { email: string; password: string }) {
    return { email, password };
  }

  @ayme.action({ description: "Sign in with every credential." })
  signInAs({ email: address }: Credentials) {
    return address;
  }

  @ayme.action({ description: "Search." })
  search(query: string, { limit = 10 }: SearchOptions = { order: "asc" }) {
    return { query, limit };
  }

  @ayme.action({ description: "Move to a point." })
  move([x, y]: [number, number]) {
    return { x, y };
  }

  @ayme.action({ description: "Follow a path." })
  follow([start, end = 9]: [number, number?], [first, ...others]: string[]) {
    return { start, end, first, others };
  }

  @ayme.action({ description: "Name a person by quoted and computed keys." })
  name({
    "first-name": first = "Ann",
    // A second binding of the property, without a default, keeps it.
    "first-name": alias,
    [lastName]: last,
  }: {
    "first-name": string;
    last: string;
  }) {
    return [first, alias, last];
  }

  @ayme.action({ description: "Sign in, the other options by a rest." })
  remember({ email, ...options }: { email: string; remember?: boolean }) {
    return { email, options };
  }

  @ayme.action({ description: "Take a tuple's fixed elements by a rest." })
  tail([head, ...rest]: [string, number, number]) {
    return { head, rest };
  }

  @ayme.action({ description: "Leave a tuple's variadic elements unbound." })
  first([x]: [number, ...number[]]) {
    return x;
  }

  @ayme.action({ description: "Take a destructured rest parameter." })
  spread(...[name, count]: [string, number]) {
    return { name, count };
  }
}
