import { dialogOpen } from "./answers";
import { TabReadError } from "./listing";

/** A dialog a Tab's page shows, as the browser tells it: its kind, such as
 * "confirm", its message, and a prompt's default value. */
export type Dialog = {
  readonly type: string;
  readonly message: string;
  readonly defaultValue?: string;
};

/**
 * A Tab's dialog as a Session counts it (rule 4): none; one that opened but
 * has not been open long enough to count; or one that counts as open, which
 * every command that needs the page is answered with.
 */
export type TabDialog = "none" | "opening" | { readonly open: Dialog };

/** Why the Session started no work on the Tab `id` at `url`: `dialog`
 * counts as open there. */
export class TabDialogOpen extends TabReadError {
  constructor(
    readonly id: string,
    readonly url: string,
    readonly dialog: Dialog
  ) {
    super(dialogOpen(dialog));
  }
}
