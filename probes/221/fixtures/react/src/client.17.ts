import * as React from "react";
import * as ReactDOM from "react-dom";
import { Root } from "./App";
const el = document.getElementById("root")!;
if (el.hasChildNodes()) ReactDOM.hydrate(React.createElement(Root), el);
else ReactDOM.render(React.createElement(Root), el);
