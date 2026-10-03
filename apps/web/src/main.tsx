import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import { AgentProvider } from "./lib/agent-context.js";
import { applyPrefs, loadPrefs } from "./lib/prefs.js";
import "./styles.css";

applyPrefs(loadPrefs());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AgentProvider>
        <App />
      </AgentProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
