import * as React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { Root } from "./App";
const el = document.getElementById("root")!;
if (el.hasChildNodes()) hydrateRoot(el, React.createElement(Root));
else createRoot(el).render(React.createElement(Root));
