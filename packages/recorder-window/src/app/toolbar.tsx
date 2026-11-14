import { bindingIn, mountToolbar } from "./toolbarMount";

// The toolbar's script: it only mounts the toolbar. The engine runs it in
// every recorded document before the page's own scripts, as Playwright runs
// a script for new documents, and in a document that was open before the
// recorder came. It shows in the top document only.

const call = bindingIn(window, document);
if (call) mountToolbar(call);
