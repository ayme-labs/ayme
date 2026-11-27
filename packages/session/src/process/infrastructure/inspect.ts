// `ayme inspect`, as the command runs it: it asks the folder's Session where
// its Inspector window is, and opens that in the person's default browser.
import {
  windowNotOpened,
  windowOpened,
  type SessionAnswer,
} from "../../session/domain";
import { askSession } from "./commands";
import { openerOf, startOpener } from "./openWindow";
import { nameOf, type SessionPlace } from "./record";

/**
 * Opens the Inspector window of `place`'s Session in the person's default
 * browser, which `environment`'s BROWSER may name, with `open`, and answers
 * where the window is. A test hands an `open` of its own, so that no window
 * opens on its machine.
 */
export async function inspectSession(
  place: SessionPlace,
  environment: { readonly BROWSER?: string | undefined },
  open: typeof startOpener = startOpener
): Promise<SessionAnswer> {
  const answer = await askSession(place, { inspector: { window: {} } });
  if (!answer.ok) return answer;
  const { address } = answer.data as { readonly address: string };
  const opener = openerOf(address, environment, process.platform);
  if (!opener) return answer;
  const why = await open(opener);
  const name = nameOf(place);
  return why === undefined
    ? windowOpened(address, name)
    : windowNotOpened(address, name, why);
}
