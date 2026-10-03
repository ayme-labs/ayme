import * as React from "react";
import { renderToString } from "react-dom/server";
import { Root } from "./App";
export const render = () => renderToString(React.createElement(Root));
