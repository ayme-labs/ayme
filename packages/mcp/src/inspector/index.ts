export { inspectCommand } from "./application/inspectCommand";
export { serveInspector } from "./application/serveInspector";
export { InspectorRelay } from "./application/inspectorRelay";
export type { InspectorWindow } from "./application/inspectorRelay";
export {
  INSPECTOR_HTML,
  INSPECTOR_INSTALL_HINT,
  INSPECTOR_PACKAGE,
  INSPECTOR_PATH,
  INSPECTOR_SCRIPT_PATH,
  INSPECTOR_SOCKET_PATH,
  inspectorUrl,
} from "./domain/externalInspector";
export { WindowRequestSchema } from "./domain/windowFrames";
export type { InspectorReply, WindowRequest } from "./domain/windowFrames";
export { externalInspectorServer } from "./infrastructure/externalInspectorServer";
export { readExternalBuild } from "./infrastructure/externalBuild";
