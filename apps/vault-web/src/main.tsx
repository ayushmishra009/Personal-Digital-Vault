import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  return (
    <main>
      <p className="eyebrow">Personal Digital Vault</p>
      <h1>Vault workspace</h1>
      <p className="notice">
        Phase 0 foundation. Vault features will be added in later approved
        phases.
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
