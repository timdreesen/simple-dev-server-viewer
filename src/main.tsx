import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { getLocale } from "./i18n";

document.documentElement.lang = getLocale();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
