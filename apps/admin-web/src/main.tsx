import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <main>
      <h1>Vault administration</h1>
      <p>
        This protected Admin/CMS application shell is not connected to
        authorization yet.
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
