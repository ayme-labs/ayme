import { ayme } from "@ayme-dev/ayme";

type Credentials = { email: string; password: string };

@ayme
export class MisspelledBindingPom {
  @ayme.action({ description: "Sign in." })
  // @ts-expect-error The binding names a property the type does not have.
  signIn({ emial, password: secret }: Credentials) {
    return [emial, secret];
  }
}
