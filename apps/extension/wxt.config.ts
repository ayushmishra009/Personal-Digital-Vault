import { defineConfig } from "wxt";
import react from "@vitejs/plugin-react";

export default defineConfig({
  vite: () => ({
    plugins: [react()],
  }),
  manifest: {
    name: "Personal Digital Vault",
    description:
      "Zero-knowledge personal vault browser extension for Chrome MV3.",
    permissions: ["storage", "activeTab", "scripting"],
    host_permissions: ["http://localhost:8080/*", "http://127.0.0.1:8080/*"],
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    action: {
      default_title: "Personal Digital Vault",
    },
  },
});
