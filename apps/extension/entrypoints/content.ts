import { defineContentScript } from "wxt/utils/define-content-script";
import { browser } from "wxt/browser";
import { fillCredentialsInDocument } from "../src/utils/dom-fill";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  allFrames: false, // Strictly top-level frame only! Rejects injection into cross-origin iframes
  runAt: "document_idle",
  main() {
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "PDV_FILL_CREDENTIALS") {
        const { username, password } = message.payload || {};
        const result = fillCredentialsInDocument(document, username, password);
        sendResponse(result);
        return true;
      }

      if (message.type === "PDV_DETECT_FORM") {
        const hasInputs = !!(
          document.querySelector('input[type="password"]') ||
          document.querySelector('input[autocomplete*="password"]')
        );
        sendResponse({ hasLoginForm: hasInputs });
        return true;
      }
    });
  },
});
