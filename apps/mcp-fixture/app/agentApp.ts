import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";

/**
 * A stand-in for an Agent App that shows MCP Apps, as the e2e tests use it:
 * it shows the page at `?frame=` (which the test serves) in the sandboxed
 * frame of `agent-app.html`, through the ext-apps SDK's own host side.
 * `?modes=` lists the display modes it offers, `inline` by default.
 * It sizes the frame as the page asks, grants any display mode it offers,
 * and keeps what the page asked for in `window.agentAppSaw`. With
 * `?announce=0` it grants a display mode in its answer only, and sends no
 * context change after it, which the MCP Apps specification allows. With
 * `?resize=0` it leaves the frame at the height it has, whatever the page
 * asks for.
 */
const frame = document.querySelector<HTMLIFrameElement>("#app")!;
const query = new URLSearchParams(location.search);
const announces = query.get("announce") !== "0";
const resizes = query.get("resize") !== "0";
const offered = (query.get("modes") ?? "inline").split(",") as (
  "inline" | "fullscreen" | "pip"
)[];
const context = {
  theme: "light" as const,
  displayMode: "inline" as const,
  availableDisplayModes: offered,
  containerDimensions: { width: 960, maxHeight: 2000 },
  platform: "desktop" as const,
};
const saw: { heights: number[]; displayModes: string[] } = {
  heights: [],
  displayModes: [],
};
Object.assign(window, { agentAppSaw: saw });

const bridge = new AppBridge(
  null,
  { name: "stand-in-agent-app", version: "0.0.0" },
  {},
  { hostContext: context }
);
bridge.onsizechange = ({ height }) => {
  if (height === undefined) return;
  saw.heights.push(height);
  if (resizes) frame.style.height = `${height}px`;
};
bridge.onrequestdisplaymode = async ({ mode }) => {
  saw.displayModes.push(mode);
  const granted = offered.includes(mode) ? mode : "inline";
  if (announces) bridge.setHostContext({ ...context, displayMode: granted });
  return { mode: granted };
};
await bridge.connect(
  new PostMessageTransport(frame.contentWindow!, frame.contentWindow!)
);
frame.src = query.get("frame")!;
