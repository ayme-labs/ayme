import { pageLoading } from "./answers";
import { TabReadError } from "./listing";

/** The document a Tab's main frame shows, as the browser tells it without
 * the page's JavaScript: `id` changes with each new document the frame
 * starts, and `url` is the address it loads. */
export type TabDocument = {
  readonly id: string;
  readonly url: string;
};

/** Why a listing of the Tab `id` at `url` read no page: the Tab's main
 * frame started loading a new document at `loading` while ayme read it. */
export class TabLoading extends TabReadError {
  constructor(
    readonly id: string,
    readonly url: string,
    readonly loading: string
  ) {
    super(pageLoading(loading));
  }
}
