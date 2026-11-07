import { createAyme } from "@ayme-dev/ayme";

import { Notes } from "./Notes";
import { PageHeading } from "./PageHeading";

/**
 * The injected bundle: starts Ayme's browser runtime with the Agent
 * Connection on, on whatever page the automation tool runs it in.
 * It records what happened on window.__aymeSpike so the driver can read it.
 */
declare global {
  interface Window {
    __aymeSpike?: {
      started: boolean;
      error?: string;
      at: string;
      runs: number;
      registered?: string;
    };
  }
}

const state = (window.__aymeSpike ??= { started: false, at: "", runs: 0 });
state.runs++;
state.at = document.readyState;
try {
  const runtime = createAyme({
    agentConnection: true,
    webMCP: { enabled: new URLSearchParams(location.search).has("webmcp") },
  });
  runtime.start();
  state.started = true;
  console.info(
    `[ayme-spike] runtime started at readyState=${state.at} run=${state.runs}`
  );
  // An init script runs before the parser creates <html>: registering a Page
  // Object then throws, since the runtime observes document.documentElement.
  const register = () => {
    try {
      runtime.pom.register(
        location.pathname.startsWith("/notes") ? Notes : PageHeading
      );
      state.registered = document.readyState;
    } catch (error) {
      state.error =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
      console.error("[ayme-spike] register failed", error);
    }
  };
  if (
    document.documentElement &&
    !new URLSearchParams(location.search).has("defer")
  ) {
    register();
  } else {
    document.addEventListener("DOMContentLoaded", register, { once: true });
  }
} catch (error) {
  state.error =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error("[ayme-spike] runtime failed", error);
}
