import { ayme } from "@ayme-dev/ayme";

@ayme
export class UntypedBindingPom {
  @ayme.action({ description: "Sign in." })
  // @ts-expect-error TypeScript types the unannotated parameter `{}`.
  login({ email, password } = {}) {
    return [email, password];
  }
}
